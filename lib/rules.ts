import assert from './asserts';

export interface NamedDependencyLike {
    readonly name: string|null;
    readonly value: string;
}

export class NamedDependency implements NamedDependencyLike {
    readonly name: string|null;
    readonly value: string;
    constructor (name : string|null, value : string) {
        this.name = name;
        this.value = value;
    }
}

export interface DependencyGenerator {
    (input: string, match: RegExpExecArray): IterableIterator<string|NamedDependencyLike>|string|NamedDependencyLike|null
}

interface DependencyGeneratorAdapter {
    create (input : string, m : RegExpExecArray) : IterableIterator<NamedDependencyLike>;
}

function isNamedDependencyLike(obj : any) : obj is NamedDependencyLike {
    return 'name' in obj && 'value' in obj;
}

export class SimpleDependencyGeneratorAdapter {
    readonly generator: string|DependencyGenerator;
    constructor (generator : string|DependencyGenerator) {
        this.generator = generator;
    }
    *create (input : string, m : RegExpExecArray) : IterableIterator<NamedDependencyLike> {
        if ('string' === typeof this.generator) {
            yield new NamedDependency(null, this.generator.replace(input, match => m[parseInt(match, 10)]));
            return;
        }
        const result = this.generator(input, m);
        if (null === result) {
            return;
        }
        if ('string' === typeof result) {
            yield new NamedDependency(null, result);
            return;
        }
        if (result instanceof NamedDependency) {
            yield result;
            return;
        }
        if (isNamedDependencyLike(result)) {
            yield result;
            return;
        }
        for (const item of result) {
            if (null !== item) {
                if ('string' === typeof item) {
                    yield new NamedDependency(null, item);
                } else {
                    yield item;
                }
            }
        }
    }
}


export interface Entry {
    readonly name: string;
    readonly contents: Promise<Buffer>;
    readonly contentsAsString: Promise<string>;
}

export interface FileEntry extends Entry {
    path: string;
    readonly mtime: Promise<Date>;
    readonly originalPath: string;
}

export interface Context {
    name?: string
    path?: string;
    readonly entries: ReadonlyArray<Entry>;
    readonly mtime: Promise<Date>
}

export interface ContextDecorator {
    (context : Context) : Context|Promise<Context>
}

export interface RuleAction {
    (context : Context): string|Buffer|Entry|Promise<string|Buffer|Entry>
}

class NoDependencies implements DependencyGeneratorAdapter {
    static readonly instance = new NoDependencies();
    *create(input: string, m: RegExpExecArray): IterableIterator<NamedDependency> { }
};

export class Rule {
    readonly pattern : RegExp;
    readonly action : RuleAction|null;
    readonly decorators: ReadonlyArray<ContextDecorator>;
    readonly dependencies: DependencyGeneratorAdapter;
    constructor (pattern : RegExp, action : RuleAction|null, dependencies : DependencyGeneratorAdapter|null, ...decorators : Array<ContextDecorator>) {
        assert.neitherNullNorUndefined(pattern, 'pattern');
        assert.neitherNullNorUndefined(dependencies, 'dependencies');
        this.pattern = pattern;
        this.action = action;
        this.dependencies = dependencies || NoDependencies.instance;
        this.decorators = decorators;
    }
    evalDependencies (input : string) : IterableIterator<NamedDependency>|null {
        const m = this.pattern.exec(input);
        if (!m) {
            return null;
        }
        return this.dependencies.create(input, m);
    }
}

class CompositeDependencyGeneratorAdapter implements DependencyGeneratorAdapter {
    private readonly first: DependencyGeneratorAdapter;
    private readonly second: DependencyGeneratorAdapter;

    constructor(first: DependencyGeneratorAdapter, second: DependencyGeneratorAdapter) {
        this.first = first;
        this.second = second;
    }

    *create(input: string, m: RegExpExecArray): IterableIterator<NamedDependency> {
        yield* this.first.create(input, m);
        yield* this.second.create(input, m);
    }
}

export class RuleBuilder {
    readonly pattern : string|RegExp;
    action: RuleAction|null;
    decorators: Array<ContextDecorator>;
    dependencies: DependencyGeneratorAdapter|null;

    constructor (pattern : string|RegExp, action : RuleAction|null = null) {
        this.pattern = pattern;
        this.action = action;
        this.decorators = [];
        this.dependencies = null;
    }
    addDependency (dependency : string|DependencyGenerator) : RuleBuilder {
        const generator = new SimpleDependencyGeneratorAdapter('string' === typeof dependency ? () => dependency : dependency);
        this.dependencies = null === this.dependencies ? generator : new CompositeDependencyGeneratorAdapter(this.dependencies, generator);
        return this;
    }
    addDecorators (...decorators : Array<ContextDecorator>) : RuleBuilder {
        this.decorators.push(...decorators);
        return this;
    }
    insertDecorator (index : number, decorator : ContextDecorator) : RuleBuilder {
        if (index >= this.decorators.length) {
            this.decorators.push(decorator);
        } else {
            this.decorators.splice(index, 0, decorator)
        }
        return this;
    }
    setAction (action : RuleAction|null) : RuleBuilder {
        this.action = action;
        return this;
    }
    build () {
        return new Rule('string' === typeof this.pattern ? new RegExp(this.pattern) : this.pattern as RegExp, this.action, this.dependencies, ...this.decorators);
    }
}