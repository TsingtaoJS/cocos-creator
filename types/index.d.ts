declare interface Logger {
    trace(...args: any[]): void
    debug(...args: any[]): void
    info(...args: any[]): void
    warn(...args: any[]): void
    error(...args: any[]): void
    fatal(...args: any[]): void
}

export declare enum SocketStatus {
    UNKNOWN = -1,
    CONNECTING = 0,
    OPEN = 1,
    CLOSING = 2,
    CLOSED = 3,
}

export declare interface Options {
    version: string
    timeout: number
    cert?: string
    maxRetries?: number
    headers?: () => { [ids: string]: string }
    logger?: Logger
    setCookie(key: string, value: any, expires: number): void
    getCookie(key: string): any
}

export declare interface EventEmitter {
    on(event: 'ready', listener: (body: any) => void): this
    once(event: 'ready', listener: (body: any) => void): this

    on(event: 'connecting', listener: (body: any) => void): this
    once(event: 'connecting', listener: (body: any) => void): this

    on(event: 'close', listener: (event: { code: number; reason: string }) => void): this
    once(event: 'close', listener: (event: { code: number; reason: string }) => void): this

    on(event: string, listener: (...args: any[]) => void): this
    once(event: string, listener: (...args: any[]) => void): this

    addListener(event: string, listener: (...args: any[]) => void): this
    removeListener(event: string, listener?: (...args: any[]) => void): void

    removeAllListeners(event?: string): void
}

export declare interface Session {
    status: SocketStatus
    connect(uri?: string): void
    close(reason?: string): void

    request<T>(route: string, params: any, opts?: { mutex?: string | boolean }): Promise<T | undefined>
    notify(route: string, params: any): void

    remlistener(event: string): void
    listener(event?: string): EventEmitter
}

declare namespace Tsingtao {
    export function createSession(uri: string, opt: Options): Session
}
export default Tsingtao
