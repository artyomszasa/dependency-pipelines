import { Entry, FileEntry, Context, Rule, RuleBuilder } from './rules';
import { Logger } from './logging';
import fsx from './fsx';

interface NamedEntry {
    readonly name: string;
    readonly entry: Entry;
}

class SimpleFileEntry implements FileEntry {
    readonly originalPath: string;
    readonly mtime: Promise<Date>;
    readonly name: string;
    readonly contents: Promise<Buffer>;
    readonly contentsAsString: Promise<string>;
    path: string;

    constructor (name: string, path : string, contents : Buffer|null = null, mtime: Date|null = null) {
        this.originalPath = path;
        this.path = path;
        this.name = name;
        this.mtime = null == mtime ? fsx.stat(this.originalPath).then(stats => stats.mtime) : Promise.resolve(mtime);
        this.contents = null == contents ? fsx.readFile(this.originalPath) : Promise.resolve(contents);
        // FIXME: detect encoding
        this.contentsAsString = this.contents.then(buffer => buffer.toString('utf-8'));
    }
}

class SimpleContext implements Context {
    private static async composeMTime (entries : Array<Entry>) {
        if (!entries.length) {
            return new Date();
        }
        const mtimes = await entries.map(e => (e as any).mtime ? (e as any).mtime : Promise.resolve(new Date()));
        mtimes.sort((a, b) => b.getTime() - a.getTime());
        return mtimes[0];
    }
    readonly entries: Array<Entry>;
    readonly mtime: Promise<Date>;
    constructor (entries : Array<NamedEntry>) {
        this.entries = entries.map(item => item.entry);
        for (const item of entries) {
            (this as any)[item.name] = item;
        }
        this.mtime = SimpleContext.composeMTime(this.entries);
    }
}

export default class Pipeline {
    readonly logger: Logger;
    readonly ruleSet: Set<Rule>;
    constructor (logger : Logger, ruleSet : Set<Rule>) {
        this.ruleSet = ruleSet;
        this.logger = logger;
    }
    async exec (input : string, name : null|string = null) : Promise<Entry> {
        this.logger.debug(`Processing ${input}...`);
        const ts = Date.now();
        let rule : Rule|null = null;
        for (const r of this.ruleSet) {
            if (r.regex.test(input)) {
                rule = r;
                break;
            }
        }
        if (!rule) {
            throw new Error(`no matching rule for ${input}`);
        }
        this.logger.trace(`Found rule for ${input}: ${rule.regex}`)
        // exec dependencies
        // FIXME: cache
        const rawDeps = rule.evalDependencies(input);
        if (!rawDeps) {
            throw new Error(`invalid matching rule for ${input}`);
        }
        this.logger.trace(`${input} depends on: ${rawDeps.map(d => d.value).join(',')}`);
        let entries : Array<NamedEntry>;
        if (rawDeps.length) {
            entries = await Promise.all(rawDeps.map(async dependency => {
                return {
                    name: dependency.name,
                    entry: await this.exec(dependency.value, dependency.name)
                };
            }));
        } else {
            entries = [];
        }
        // exec action
        if (!rule.action) {
            throw new Error('default actions not yet supported');
        }
        const context = new SimpleContext(entries);
        let result : Entry;
        // try get as file
        const mtime = await fsx.stat(input).then(stats => stats.mtime, () => new Date());
        const depMTime = await context.mtime;
        if (mtime.getTime() < depMTime.getTime()) {
            this.logger.trace(`${input} is up to date (dependencies mtime ${depMTime} > target mtime ${mtime}), skipping.`);
            result = new SimpleFileEntry(name || input, input, null, mtime);
        } else {
            // perform action
            const actionResult = await rule.action(context);
            if (actionResult instanceof Buffer) {
                result = {
                    name: name || input,
                    contents: Promise.resolve(actionResult),
                    contentsAsString: new Promise(resolve => resolve(actionResult.toString('utf-8')))
                };
            } else if ('string' === typeof actionResult) {
                result = {
                    name: name || input,
                    contents: new Promise(resolve => resolve(Buffer.from(actionResult, 'utf-8'))),
                    contentsAsString: Promise.resolve(actionResult)
                };
            } else {
                result = actionResult;
            }
        }
        const diff = Date.now() - ts;
        this.logger.info(`Done processing ${input} in ${diff} ms`);
        return result;
    }
}
