// A connection class that handles asynchronous operations and transmission of message objects

interface Connection<T> {}

import WebSocket = require('isomorphic-ws');
import { config } from 'process';
import { getCombinedModifierFlags } from 'typescript';

import { Message, Config} from './Message';


type IOnMessage<T> = (message: Message<T>) => void;
type IOnEvent<T> = (message: Message<T>) => void;
type IOnForwarded<T> = (message: Message<T>, id: number) => void;
type IOnRoomCreated<T> = (roomid: number) => void;
type IOnConnect<T> = (event: WebSocket.OpenEvent) => void;
type IOnClose<T> = (event: WebSocket.CloseEvent) => void;

// Util used to convert string to arraybuffer
function stringToAB(str: string){
    var buf = new ArrayBuffer(str.length); // 1 bytes for each char
    var bufView = new Uint8Array(buf);
    for (var i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

// Util used to convert array buffer to string
function ABToString(arr: ArrayBuffer)
{
    return String.fromCharCode.apply(null, Array.from(new Uint8Array(arr)));
}

class Connection<T> {
    
    private ws: WebSocket | undefined;

    // All event callbacks
    private eventCallbacks: Map<T, IOnEvent<T>>;

    public OnMessage: IOnMessage<T> | undefined;
    public OnClose: IOnClose<T> | undefined;
    public OnConnect: IOnConnect<T> | undefined;
    public OnBroadCast: IOnForwarded<T> | undefined;
    public OnRoomCreated: IOnRoomCreated<T> | undefined;
    public OnRoomJoined: IOnEvent<T> | undefined;
    public OnForwarded: IOnForwarded<T> | undefined;

    constructor() {
        this.eventCallbacks = new Map();
    }

    connectToServer(host: string, port: number): void {
        
        // Create a websocket 
        this.ws = new WebSocket("ws://" + host + ":" + port);
        this.ws.binaryType = "arraybuffer";
        this.ws.onopen = (ev: WebSocket.OpenEvent) => {
            this.configure();
            if (this.OnConnect)
            {
                this.OnConnect(ev);
            }
        }

    }

    // Setup the required websocket callbacks
    private configure(): void {
        if (this.ws === undefined || this.ws === null)
        {
            return;
        }

        this.ws.onmessage = (ev:WebSocket.MessageEvent) => {
            
            // Message object to contain data
            const message = new Message<T>(); 
            
            message.deserializeBinary(new Uint8Array(ev.data as ArrayBuffer));
            
            // Check if the message is broadcasted
            if (message.Config() == Config.Broadcasted && this.OnBroadCast)
            {
                // Get the forwarder id
                const data: string | Uint8Array = message.data(true);
                if (data)
                {
                    //const buf = stringToAB(data);
                    const id:number = Buffer.from(data.slice(-4)).readUInt32LE();
                    message.setData(data.slice(0, -4));
                    this.OnBroadCast(message, id);
                }
            }
            // Check if that message is a create room response
            else if (message.Config() == Config.CreateRoomResponse && this.OnRoomCreated)
            {
                const data = message.data();
                if (data)
                    this.OnRoomCreated(parseInt(data as string));
            }
            
            // Check if the message is a room joining response
            else if (message.Config() == Config.OnRoomJoined && this.OnRoomJoined)
            {
                this.OnRoomJoined(message);
            }
            // Check if the message is forwarded
            else if (message.Config() == Config.Forwarded && this.OnForwarded)
            {
                // Get the forwarder id
                const data = message.data(true);
                if (data)
                {
                    const id:number = Buffer.from(data.slice(-4)).readUInt32LE();
                    //const remData = buf.slice(0, buf.byteLength - 2);
                    message.setData(data.slice(0, -4));
                    this.OnForwarded(message, id);

                }
            }
            // find if there are any event callbacks assigned for this event
            else if (this.eventCallbacks.get(message.ID()) != undefined 
                && message.ID() != undefined)
            {
                this.eventCallbacks.get(message.ID())?.(message);

            }else if (!(typeof this.OnMessage === 'undefined' || this.OnMessage === null))
            {
                this.OnMessage(message);
            }

        }

        this.ws.onclose = (ev: WebSocket.CloseEvent) => {
            if (!(typeof this.OnClose === 'undefined' || this.OnMessage === null))
            {
                this.OnClose(ev);
            }
        }
    }

    public OnEvent(event: T, callback: IOnEvent<T>)
    {
        this.eventCallbacks.set(event, callback);
    }

    public send(message: Message<T>)
    {
        this.ws?.send(message.serializeBinary());
    }

    public broadcast(message: Message<T>)
    {
        message.setConfig(Config.BroadcastAll);
        this.send(message);
    }

    public forward(message: Message<T>, to: number)
    {
        let payload: string | Uint8Array | undefined = message.data(true);

        if (!payload)
        {
            payload = new Uint8Array();
        }

        // Combine data payload with the recp id
        const buf = new ArrayBuffer(4);
        const view = new Uint32Array(buf);
        view[0] = to;
        const idArr = new Uint8Array(buf);
        const payloadArr = payload as Uint8Array;
        const resultArr = new Uint8Array(payloadArr.length + idArr.length);
        resultArr.set(payloadArr);
        resultArr.set(idArr, payloadArr.length);

        message.setData(resultArr);
        message.setConfig(Config.Forward);
        this.send(message);
    }

    /**
     * Broadcast a message to all clients in room with roomid
     */
    public broadcastRoom(message: Message<T>, roomid: number)
    {
        let payload: string | Uint8Array | undefined = message.data(true);
        
        if (!payload)
        {
            payload = "";
        }

        // Combine data payload with recp id
        // Combine data payload with the recp id
        const buf = new ArrayBuffer(4);
        const view = new Uint32Array(buf);
        view[0] = roomid;
        const idArr = new Uint8Array(buf);
        const payloadArr = payload as Uint8Array;
        const resultArr = new Uint8Array(payloadArr.length + idArr.length);
        resultArr.set(payloadArr);
        resultArr.set(idArr, payloadArr.length);
        message.setData(resultArr);
        message.setConfig(Config.BroadcastRoom);

        this.send(message);
    }

    /**
     * Create a room that other people can join
     */
    public createRoom()
    {
        const msg: Message<T> = new Message<T>();
        msg.setConfig(Config.CreateRoom);

        this.send(msg);
    }

    /**
     * Join a room that is created
     */
    public joinRoom(roomid: number)
    {
        const msg: Message<T> = new Message<T>(roomid.toString());
        msg.setConfig(Config.JoinRoom);
    }

    public isConnected(): boolean {

        if (! this.ws || !this.ws?.OPEN)
        {
            return false;
        }
        return true;
    }
    public close()
    {
        this.ws?.close();
    }

};

export { Connection };




