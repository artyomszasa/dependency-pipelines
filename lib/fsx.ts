import { stat as fsStat, readFile as fsReadFile, Stats } from 'fs';

export function stat(path : string): Promise<Stats> {
    return new Promise((resolve, reject) => {
        fsStat(path, (err : any, stats : Stats) => {
            if (err || !stats) {
                reject(err);
            } else {
                resolve(stats);
            }
        });
    });
};

export function readFile(path : string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        fsReadFile(path, (err : any, buffer : Buffer) => {
            if (err || !buffer) {
                reject(err);
            } else {
                resolve(buffer);
            }
        });
    })
}

export default {
    stat,
    readFile
}