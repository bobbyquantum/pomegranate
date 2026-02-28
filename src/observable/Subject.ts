/**
 * Lightweight observable primitives.
 *
 * We avoid pulling in RxJS by implementing a minimal Subject/Observable
 * that covers the use-cases we need: change notification for records,
 * collections, and live queries.
 */

export type Listener<T> = (value: T) => void;
export type Unsubscribe = () => void;
export type TeardownFn = () => void;

/**
 * A minimal Observable that supports subscribe/unsubscribe.
 */
export interface Observable<T> {
  subscribe(listener: Listener<T>): Unsubscribe;
}

/**
 * A Subject is an Observable that you can push values into.
 *
 * NOTE: We use ES `#private` fields (not TypeScript `private`) so that the
 * internal `Set<Listener<T>>` is invisible to the structural type checker.
 * Without this, `Subject<Post>` is not assignable to `Subject<Model>` because
 * `Set` is invariant — a classic generic-variance pitfall.
 */
export class Subject<T> implements Observable<T> {
  #listeners = new Set<Listener<T>>();
  #lastValue: T | undefined;
  #hasValue = false;

  constructor(initialValue?: T) {
    if (arguments.length > 0) {
      this.#lastValue = initialValue;
      this.#hasValue = true;
    }
  }

  get lastValue(): T | undefined {
    return this.#lastValue;
  }

  get hasValue(): boolean {
    return this.#hasValue;
  }

  subscribe(listener: Listener<T>): Unsubscribe {
    this.#listeners.add(listener);
    // Immediately emit last value if we have one
    if (this.#hasValue) {
      listener(this.#lastValue as T);
    }
    return () => {
      this.#listeners.delete(listener);
    };
  }

  next(value: T): void {
    this.#lastValue = value;
    this.#hasValue = true;
    for (const listener of this.#listeners) {
      listener(value);
    }
  }

  get subscriberCount(): number {
    return this.#listeners.size;
  }
}

/**
 * A BehaviorSubject always has a current value and emits it to new subscribers.
 */
export class BehaviorSubject<T> extends Subject<T> {
  constructor(initialValue: T) {
    super(initialValue);
  }

  get value(): T {
    return this.lastValue as T;
  }
}

/**
 * SharedObservable caches the latest result and replays to new subscribers.
 * Runs a producer function when the first subscriber appears,
 * and tears down when the last subscriber leaves.
 */
export class SharedObservable<T> implements Observable<T> {
  private subject: Subject<T> | null = null;
  private teardown: TeardownFn | null = null;

  constructor(private producer: (emit: Listener<T>) => TeardownFn) {}

  subscribe(listener: Listener<T>): Unsubscribe {
    if (!this.subject) {
      this.subject = new Subject<T>();
      this.teardown = this.producer((value) => this.subject!.next(value));
    }

    const unsub = this.subject.subscribe(listener);

    return () => {
      unsub();
      if (this.subject && this.subject.subscriberCount === 0) {
        this.teardown?.();
        this.teardown = null;
        this.subject = null;
      }
    };
  }
}

/**
 * Utility: map an observable to a new observable.
 */
export function mapObservable<A, B>(source: Observable<A>, fn: (value: A) => B): Observable<B> {
  return {
    subscribe(listener: Listener<B>): Unsubscribe {
      return source.subscribe((value) => listener(fn(value)));
    },
  };
}

/**
 * Utility: combine multiple observables into one that emits an array.
 */
export function combineObservables<T>(sources: Observable<T>[]): Observable<T[]> {
  return {
    subscribe(listener: Listener<T[]>): Unsubscribe {
      const values: (T | undefined)[] = Array.from({ length: sources.length });
      const received = new Set<number>();
      const unsubs: Unsubscribe[] = [];

      sources.forEach((source, i) => {
        unsubs.push(
          source.subscribe((value) => {
            values[i] = value;
            received.add(i);
            if (received.size === sources.length) {
              listener([...values] as T[]);
            }
          }),
        );
      });

      return () => unsubs.forEach((u) => u());
    },
  };
}
