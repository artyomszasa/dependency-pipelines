
class Sequence {
    static map<TSource, TResult> (source: IterableIterator<TSource>, selector: ((item: TSource) => TResult)) : IterableIterator<TResult> {
        return {
            next () : IteratorResult<TResult> {
                const next = source.next();
                if (next.done) {
                    return { done: true, value: undefined! };
                }
                return { done: false, value: selector(next.value) };
            },
            [Symbol.iterator]() {
                return this;
            }
        };
    }
}