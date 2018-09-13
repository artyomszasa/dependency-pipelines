import { Context, RuleAction, Entry } from './rules';
import { writeFilep } from './fsx';

export const store : RuleAction = async (context : Context) => {
    const entry = context.entries[0];
    const path = context.path || context.name;
    if (entry && path) {
        const contents = await entry.contents;
        await writeFilep(path, contents);
        return contents;
    }
    throw new Error('Failed to store (missing path or entry)!');
};

export const storeDeps : RuleAction = async (context : Context) => {
    await Promise.all(context.entries.map(async entry => await writeFilep((entry as any).path || entry.name, await entry.contents)));
    return {
        name: context.name || '',
        contents: Promise.resolve(Buffer.from([])),
        contentsAsString: Promise.resolve('')
    };
}

export const pass : RuleAction = (context : Context): Entry => {
    const entry = context.entries[0];
    if (!entry) {
        throw new Error('Failed to pass (missing source entry)!');
    }
    return {
        name: context.name || entry.name || "source",
        contents: entry.contents,
        contentsAsString: entry.contentsAsString
    };
};