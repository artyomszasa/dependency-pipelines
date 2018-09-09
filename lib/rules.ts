import assert from './asserts';

export class NamedDependency {
    readonly name: string;
    readonly value: string;
    constructor (name : string, value : string) {
        this.name = name;
        this.value = value;
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
    readonly entries: Array<Entry>;
    readonly mtime: Promise<Date>
}

export interface RuleAction {
    (context : Context): Promise<string|Buffer|Entry>
}

export class Rule {
    private static readonly pattern = '\\{[^}]\\}';
    readonly regex : RegExp;
    readonly action : RuleAction|null;
    readonly dependencies: Array<NamedDependency>;
    constructor (regex : RegExp, action : RuleAction|null, dependencies : Array<NamedDependency>) {
        assert.neitherNullNorUndefined(regex, 'regex');
        assert.neitherNullNorUndefined(dependencies, 'dependencies');
        this.regex = regex;
        this.action = action;
        this.dependencies = dependencies;
    }
    evalDependencies (input : string) : Array<NamedDependency>|null {
        const m = this.regex.exec(input);
        if (!m) {
            return null;
        }
        return this.dependencies.map(d => new NamedDependency(d.name, d.value.replace(input, match => m[parseInt(match, 10)])));
    }
}

export class RuleBuilder {
    readonly regex : string|RegExp;
    action: RuleAction|null;
    dependencies: Array<NamedDependency>;

    constructor (regex : string|RegExp, action : RuleAction|null = null) {
        this.regex = regex;
        this.action = action;
        this.dependencies = [];
    }
    setAction (action : RuleAction|null) : RuleBuilder {
        this.action = action;
        return this;
    }
    addDependency (name: string, dependency : string) : RuleBuilder {
        this.dependencies.push(new NamedDependency(name, dependency))
        return this;
    }
    build () {
        return new Rule('string' === typeof this.regex ? new RegExp(this.regex) : this.regex as RegExp, this.action, this.dependencies);
    }
}