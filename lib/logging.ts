export class LogLevel {
    static readonly trace = 0;
    static readonly debug = 1;
    static readonly information = 2;
    static readonly warning = 3;
    static readonly error = 4;
    static readonly fatal = 5;
}

export interface Logger {
    log(logLevel : number, ...args : Array<Error|string>): void;
    trace(...args : Array<Error|string>): void;
    debug(...args : Array<Error|string>): void;
    info(...args : Array<Error|string>): void;
    warn(...args : Array<Error|string>): void;
    error(...args : Array<Error|string>): void;
    fatal(...args : Array<Error|string>): void;
}