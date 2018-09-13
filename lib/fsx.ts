import { stat as fsStat, readFile as fsReadFile, writeFile as fsWrireFile, mkdir as fsMkdir, Stats } from 'fs';
import { dirname } from 'path';

async function optimisticMkdirp (path: string, mode?: number|string|null) {
    try {
        await mkdir(path, mode);
    } catch (error) {
        switch (error.code) {
            case 'ENOENT':
                // Recursively move down tree until we find a dir that exists.
                await optimisticMkdirp(dirname(path), mode);
                // Bubble back up and create every dir.
                await optimisticMkdirp(path, mode);
                break;
            default:
                // If EEXISTS error, check if it's a file or directory
                // If it's not a directory throw.
                const stats = await stat(path);
                if (!stats.isDirectory()) {
                    throw error;
                }
                break;
        }
    }
}



async function ensureDirectory (path: string, mode?: number|string|null, throwOnError: boolean = true) : Promise<string|null> {
    if (null === path) {
        if (throwOnError) {
            throw new Error(`Failed to ensure directory ${path}`);
        }
        return "Failed to ensure directory";
    }
    const stat = await statSafe(path);
    if (null === stat) {
        // does not exist --> ensure parent and try again
        const err = await ensureDirectory(dirname(path), mode, false);
        if (err) {
            if (throwOnError) {
                throw new Error(`Failed to ensure directory ${path}`);
            }
            return err;
        }
        // retry
        return await ensureDirectory(path, mode, throwOnError);
    } else {
        if (stat.isDirectory()) {
            return null;
        } else {
            throw new Error(`Failed to ensure directory (${path} exists and is not a directory)`);
        }
    }
}

async function pessimisticMkdirp (path: string, mode?: number|string|null) { await ensureDirectory(path, mode, true); }

export const mkdirp = process.env.DEBUG ? pessimisticMkdirp : optimisticMkdirp;

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

export function statSafe(path : string): Promise<Stats|null> {
    return new Promise(resolve => {
        fsStat(path, (err : any, stats : Stats) => {
            if (err || !stats) {
                resolve(null)
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
    });
}

export function writeFile (path: string, data: any, encoding?: string) {
    return new Promise((resolve, reject) => fsWrireFile(path, data, encoding, err => err ? reject(err) : resolve()));
}

export async function writeFilep (path: string, data: any, encoding?: string) {
    const directory = dirname(path);
    if (directory) {
        await mkdirp(directory);
    }
    await writeFile(path, data, encoding);
}

export function mkdir(path: string, mode?: string|number|null) {
    return new Promise((resolve, reject) => {
        fsMkdir(path, mode, err => err ? reject(err) : resolve());
    });
}

export function mtimeSafe(path : string) : Promise<Date|null> {
    return new Promise(resolve => {
        fsStat(path, (err : any, stats : Stats) => {
            if (err || !stats) {
                resolve(null)
            } else {
                resolve(stats.mtime);
            }
        });
    });
}

export default {
    stat,
    readFile,
    mtimeSafe
}