import { EventEmitter } from 'events'
import { find, remove } from 'lodash'
import { Options } from '../types'
import { WebSocketImpl } from './websocket/socket'

enum Events {
    NORMAL = 0,
    PING = 1,
    PONG = 2,
    HANDSHAKE = 3,
    READY = 4,
    KICK = 5,
    COOKIE = 6,
}

enum SocketStatus {
    UNKNOWN = -1,
    CONNECTING = 0,
    OPEN = 1,
    CLOSING = 2,
    CLOSED = 3,
}

declare interface Socket {
    status: number

    on(event: 'open', listener: () => void): this
    on(event: 'ready', listener: (body: any) => void): this
    on(event: 'message', listener: (message: { id?: number; event: string; body: any }) => void): this
    on(event: 'cookie', listener: (cookie: { key: string; value: any; expires: number }) => void): this
    on(event: 'close', listener: (code: number, reason?: string) => void): this
    on(event: 'error', listener: (error: Error) => void): this

    send(msg: object | string, event?: Events): void
    close(code: number, reason?: string): void
}

class Logger {
    trace(...args: any[]) {
        console.log(...args)
    }
    debug(...args: any[]) {
        console.log(...args)
    }
    info(...args: any[]) {
        console.log(...args)
    }
    warn(...args: any[]) {
        console.log(...args)
    }
    error(...args: any[]) {
        console.log(...args)
    }
    fatal(...args: any[]) {
        console.log(...args)
    }
}

export default class Session extends EventEmitter {
    socket: Socket | undefined
    opts: Options
    uri: string
    requestId: number = 0
    penddings: Map<number, { resolve: Function }> = new Map()
    askings: { id?: number; route: string; params: any; promise: Promise<any> }[] = []
    retries: number = 0
    logger: Logger
    _listeners: Map<string, EventEmitter> = new Map()
    constructor(uri: string, opts: Options) {
        super()
        this.opts = opts
        this.uri = uri
        this.logger = opts.logger || (opts.logger = new Logger())
        this.listener()

        this.on('close', (event) => {
            delete this.socket
            this._listeners.forEach((emitter) => emitter.emit('close', event))
        })
        this.on('ready', (event) => this._listeners.forEach((emitter) => emitter.emit('ready', event)))
    }

    get status() {
        if (this.socket) return this.socket.status
        return -1
    }

    listener(event: string = 'default') {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new EventEmitter())
        }
        return this._listeners.get(event)
    }

    remlistener(event: string) {
        this._listeners.delete(event)
    }

    connect(uri?: string) {
        if (uri) this.uri = uri

        if (this.socket) return

        this.logger.trace('connect to server', { uri: this.uri })
        const protos = /^(\w+)\:\/\//.exec(this.uri)
        if (protos) {
            switch (protos[1]) {
                case 'ws':
                case 'wss':
                    {
                        console.log('create websocket connection', { uri: this.uri, opts: this.opts })
                        this.socket = new WebSocketImpl(this.uri, this.opts as any)
                    }
                    break
                case 'udp':
                case 'tcp':
                case 'http':
                case 'https':
                case 'quic':
            }
        }
        if (!this.socket) return

        this.socket.on('open', () => {
            this.logger.trace('scoket open')
            const headers = this.opts.headers ? this.opts.headers() : {}
            this.socket?.send(
                {
                    version: this.opts.version,
                    date: Date.now(),
                    headers,
                    cookies: {
                        session: this.opts.getCookie('session'),
                    },
                },
                Events.HANDSHAKE
            )
        })

        this.socket.on('message', ({ id, event, body }) => {
            if (!id) {
                this._listeners.forEach((emitter) => emitter.emit(event, body))
            } else {
                const pendding = this.penddings.get(id)
                if (pendding) {
                    pendding.resolve(body)
                    this.penddings.delete(id)
                }
            }
        })

        this.socket.on('close', (code, reason) => {
            this.logger.trace('socket close', { code, reason })
            if (code >= 3000) {
                this.retries = 0
                return this.emit('close', { code, reason })
            } else {
                this.retries++
                if (!this.opts.maxRetries || this.retries > this.opts.maxRetries) {
                    this.retries = 0
                    this.emit('close', { code, reason })
                } else {
                    delete this.socket
                    this.socket = undefined
                    setTimeout(() => {
                        this.connect()
                    }, 1000)
                }
            }
        })

        this.socket.on('error', (err) => {
            this.logger.error('socket had an accident', err)
            this.socket?.close(1000, err.message)
        })

        this.socket.on('cookie', (cookie) => {
            this.opts.setCookie(cookie.key, cookie.value, cookie.expires)
        })

        this.socket.on('ready', (body) => {
            this.logger.trace('socket ready', body)
            this.retries = 0
            this.emit('ready', body)
        })
    }

    request(route: string, params: any, opts?: { mutex: string | boolean }) {
        if (this.status !== SocketStatus.OPEN) {
            return
        }
        const pendding = opts && opts.mutex ? find(this.askings, { route: typeof opts.mutex === 'boolean' ? route : opts.mutex }) : undefined
        if (pendding) {
            this.logger.debug('pendding request', route, params, this.askings)
            return pendding.promise
        }

        const id = ++this.requestId
        const promise = new Promise((resolve, reject) => {
            this.socket?.send({ id, route, params })
            const timeout = setTimeout(() => {
                reject(new Error('timeout'))
                this.penddings.delete(id)
                remove(this.askings, { id })
            }, 5000)
            this.penddings.set(id, {
                resolve: (body: any) => {
                    clearTimeout(timeout)
                    remove(this.askings, { id })
                    resolve(body)
                },
            })
        })
        this.askings.push({ id, route, params, promise })
        return promise
    }

    notify(route: string, params: any) {
        if (this.status !== SocketStatus.OPEN) {
            return
        }
        this.socket?.send({ route, params })
    }

    close(reason?: string) {
        if (this.socket && this.socket.status === SocketStatus.OPEN) {
            this.logger.debug('close session', { reason })
            this.socket.close(3000, reason)
        }
    }
}
