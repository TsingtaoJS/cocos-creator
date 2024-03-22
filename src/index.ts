import Session from './session'

export function createSession(uri: string, opt: any) {
    return new Session(uri, opt)
}

export default { createSession }
