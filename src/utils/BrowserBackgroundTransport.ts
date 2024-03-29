import Transport from "winston-transport";

export interface WinstonInfo {
    level: string;
    message: string;

    //eslint-disable-next-line @typescript-eslint/no-explicit-any -- this is the type signature from the winston-transport package
    [key: string]: any; // for the rest properties in 'meta'
}

export class BrowserBackgroundTransport extends Transport {
    constructor(opts: Transport.TransportStreamOptions) {
        super(opts);
    }

    log(info: WinstonInfo, callback: () => void) {
        if (!callback) {//seems to be standard practice in winston custom transports
            callback = () => {
            };
        }

        chrome.runtime.sendMessage({reqType: "log", payload: info})
            .then(
                (resp) => {
                    setImmediate(() => {
                        this.emit('logged', resp, info);
                    });
                    callback();
                },
                (err) => {
                    setImmediate(() => {
                        this.emit('error', err, info);
                    });
                    callback();
                }
            );
    }
}