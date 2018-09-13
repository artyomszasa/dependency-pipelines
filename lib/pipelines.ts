import { Entry, FileEntry, Context, Rule, RuleBuilder } from './rules';
import { Logger, LogLevel } from './logging';
import fsx from './fsx';

interface NamedEntry {
    readonly name: string|null;
    readonly entry: Entry;
}

export class SimpleFileEntry implements FileEntry {
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
    private static getMTime (entry : any) {
        if (entry.mtime && entry.mtime instanceof Promise) {
            return entry.mtime as Promise<Date>;
        }
        return null;
    }
    private static async composeMTime (entries : ReadonlyArray<Entry>) {
        if (!entries.length) {
            return new Date();
        }
        const mtimes = await Promise.all(entries.map(async e => (await this.getMTime(e)) || new Date()));
        mtimes.sort((a, b) => b.getTime() - a.getTime());
        return mtimes[0];
    }
    readonly input: string;
    readonly name?: string;
    readonly entries: ReadonlyArray<Entry>;
    readonly mtime: Promise<Date>;
    constructor (input: string, name: string|undefined, entries : Array<NamedEntry>) {
        this.input = input;
        this.name = name;
        this.entries = entries.map(item => item.entry);
        for (const item of entries) {
            if (item.name) {
                (this as any)[item.name] = item.entry;
            }
        }
        this.mtime = SimpleContext.composeMTime(this.entries);
    }
}

class ConsoleLogger implements Logger {
    log(logLevel: number, ...args: (string | Error)[]): void {
        const errors = args.filter(e => e instanceof Error) as Array<Error>;
        const messages = args.filter(e => !(e instanceof Error)) as Array<string>;
        if (logLevel < LogLevel.information) {
            messages.forEach(msg => console.debug(msg));
            errors.forEach(err => console.debug(err));
        } else if (logLevel < LogLevel.warning) {
            messages.forEach(msg => console.log(msg));
            errors.forEach(err => console.log(err));
        } else if (logLevel < LogLevel.error) {
            messages.forEach(msg => console.warn(msg));
            errors.forEach(err => console.warn(err));
        } else {
            messages.forEach(msg => console.error(msg));
            errors.forEach(err => console.error(err));
        }
    }
    trace(...args: (string | Error)[]): void {
        this.log(LogLevel.trace, ...args);
    }
    debug(...args: (string | Error)[]): void {
        this.log(LogLevel.debug, ...args);
    }
    info(...args: (string | Error)[]): void {
        this.log(LogLevel.information, ...args);
    }
    warn(...args: (string | Error)[]): void {
        this.log(LogLevel.warning, ...args);
    }
    error(...args: (string | Error)[]): void {
        this.log(LogLevel.error, ...args);
    }
    fatal(...args: (string | Error)[]): void {
        this.log(LogLevel.fatal, ...args);
    }
}

class FilteredConsoleLogger extends ConsoleLogger {
    readonly minLogLevel: number;
    constructor (minLogLevel: number) {
        super();
        this.minLogLevel = minLogLevel;
    }
    log(logLevel: number, ...args: (string | Error)[]): void {
        if (logLevel >= this.minLogLevel) {
            super.log(logLevel, ...args);
        }
    }
}

interface RuleBuildAction {
    (builder : RuleBuilder): void
}

interface PipelineBuilderAction {
    (builder : PipelineBuilder): void
}

export class PipelineBuilder {
    ruleSet: Set<Rule>;
    constructor () {
        this.ruleSet = new Set<Rule>();
    }
    add (regex : string|RegExp, build : RuleBuildAction) : PipelineBuilder {
        const builder = new RuleBuilder(regex);
        build(builder);
        this.ruleSet.add(builder.build());
        return this;
    }
}

export class Pipeline {
    static build(build : PipelineBuilderAction, logger : null|Logger = null) {
        var builder = new PipelineBuilder();
        build(builder);
        return new Pipeline(logger, builder.ruleSet);
    }
    readonly logger: Logger;
    readonly ruleSet: Set<Rule>;
    constructor (logger : null|Logger|number, ruleSet : Set<Rule>) {
        this.ruleSet = ruleSet;
        this.logger = ('number' === typeof logger ? new FilteredConsoleLogger(logger) : (logger || new ConsoleLogger()));
    }
    async exec (input : string, name?: string) : Promise<Entry> {
        this.logger.debug(`Processing ${input}...`);
        const ts = Date.now();
        let rule : Rule|null = null;
        for (const r of this.ruleSet) {
            if (r.pattern.test(input)) {
                rule = r;
                break;
            }
        }
        let result : Entry;
        // try get as file
        const mtime = await fsx.mtimeSafe(input);
        if (!rule) {
            if (null !== mtime) {
                result = new SimpleFileEntry(name || input, input, null, mtime);
            } else {
                throw new Error(`no matching rule for ${input}`);
            }
        } else {
            this.logger.trace(`Found rule for ${input}: ${rule.pattern}`)
            // exec dependencies
            // FIXME: cache
            const rawDepsOrNull = rule.evalDependencies(input);
            if (!rawDepsOrNull) {
                throw new Error(`invalid matching rule for ${input}`);
            }
            const rawDeps = Array.from(rawDepsOrNull);
            this.logger.trace(`${input} depends on: ${rawDeps.map(d => d.value).join(',')}`);
            let entries : Array<NamedEntry> = [];
            if (rawDeps.length) {
                for (const dependency of rawDeps) {
                    const entry = {
                        name: dependency.name,
                        entry: await this.exec(dependency.value, dependency.name || undefined)
                    };
                    entries.push(entry);
                }
            }
            // exec action
            if (!rule.action) {
                throw new Error('default actions not yet supported');
            }
            const context = new SimpleContext(input, name, entries);
            // if file is older than its dependencies --> do not invoke dependencies
            const depMTime = await context.mtime;
            if (null != mtime && (!entries.length || mtime.getTime() > depMTime.getTime())) {
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
        }
        const diff = Date.now() - ts;
        this.logger.debug(`Done processing ${input} in ${diff} ms`);
        return result;
    }
}

export import actions = require('./actions');