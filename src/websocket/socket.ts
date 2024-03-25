import { EventEmitter } from 'events'

function decode(binary: ArrayBuffer) {
    const view = new DataView(binary)
    const head = view.getUint32(0)
    const event = head >> 24
    const length = head & 0xffffff
    const body = binary.slice(4, 4 + length)
    return { event, body }
}

function encode(event: number, binary: Uint8Array) {
    const length = binary.byteLength & 0xffffff
    const body = new Uint8Array(length + 4)
    body[0] = event & 0xff
    body[1] = (length >> 16) & 0xff0000
    body[2] = (length >> 8) & 0xff00
    body[3] = length & 0xff
    body.set(binary, 4)
    return body
}

enum Events {
    NORMAL = 0,
    PING = 1,
    PONG = 2,
    HANDSHAKE = 3,
    READY = 4,
    KICK = 5,
    COOKIE = 6,
}

export enum SocketStatus {
    CONNECTING = 0,
    OPEN = 1,
    CLOSING = 2,
    CLOSED = 3,
}

export class WebSocketImpl extends EventEmitter {
    socket: WebSocket

    pinging: number = 0
    distance: number = 0

    _timer: number
    _pingtimer: number = 0
    _active: number = Date.now()
    logger: any

    constructor(url: string, opts: { cert?: string; timeout: number; logger: any }) {
        super()
        this.logger = opts.logger

        const protos = /^(\w{2,3})\:\/\//.exec(url)
        if (protos && protos[1] === 'wss') {
            //@ts-ignore
            this.socket = new WebSocket(url, undefined, opts?.cert)
            this.logger.trace('inited ssl websocket', url)
        } else {
            this.socket = new WebSocket(url)
            this.logger.trace('inited websocket', url)
        }
        this.socket.binaryType = 'arraybuffer'

        this.socket.onmessage = (event) => {
            if (event.data.byteLength == 0) {
                this.close(1000)
                return
            }
            this.logger.trace('receive message', { bytes: event.data.byteLength })
            this._active = Date.now()
            const msg = decode(event.data)
            const decoder = new TextDecoder()
            switch (msg.event) {
                case Events.NORMAL:
                    {
                        try {
                            const body = JSON.parse(decoder.decode(msg.body)) as { id?: number; event: string; body: any }
                            this.logger.trace('decode message', { id: body.id, event: body.event })
                            this.emit('message', body)
                        } catch (_) {}
                    }
                    break
                case Events.PONG:
                    {
                        this.logger.trace('pong')
                        this.distance = Date.now() - this.pinging
                        this.pinging = 0
                        this.ping()
                    }
                    break
                case Events.COOKIE:
                    {
                        const cookie = JSON.parse(decoder.decode(msg.body))
                        this.logger.trace('receive cookie', cookie)
                        this.emit('cookie', cookie)
                    }
                    break
                case Events.KICK:
                    {
                        const body = JSON.parse(decoder.decode(msg.body))
                        this.logger.trace('receive kick', body)
                        this.close(3001, body.reason)
                    }
                    break
                case Events.READY:
                    {
                        const body = JSON.parse(decoder.decode(msg.body))
                        this.logger.trace('session ready', body)
                        this.emit('ready', body)
                        this.ping()
                    }
                    break
            }
        }

        this.socket.onopen = () => this.emit('open')
        this.socket.onclose = (event) => this.emit('close', event.code, event.reason)
        this.socket.onerror = (error) => this.emit('error', error)

        this._timer = setInterval(() => {
            if (Date.now() - this._active > opts.timeout) {
                this.emit('error', new Error('timeout'))
            }
        }, 1000)
    }

    get status() {
        return this.socket.readyState as SocketStatus
    }

    send(msg: object | string, event: Events = Events.NORMAL) {
        this.logger.trace('send message', { event, msg })
        this.socket.send(encode(event, new TextEncoder().encode(typeof msg === 'object' ? JSON.stringify(msg) : msg)))
    }

    ping() {
        if (this.pinging > 0) return
        this._pingtimer = setTimeout(() => {
            this.pinging = Date.now()
            this.socket.send(encode(Events.PING, new Uint8Array(0)))
        }, 1000)
    }

    close(code: number, reason?: string) {
        if (this.status === SocketStatus.CLOSED) return

        this.logger.trace('close socket', { code, reason })
        this.clear()
        this.socket.close(code, reason)
    }

    clear() {
        if (this._pingtimer) clearTimeout(this._pingtimer)
        if (this._timer) clearInterval(this._timer)
    }
}
