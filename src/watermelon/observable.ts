/**
 * rxjs-shaped observables for the WatermelonDB compatibility layer.
 *
 * WatermelonDB returns rxjs Observables; PomegranateDB's core uses a minimal
 * `{ subscribe(listener) => unsubscribe }` shape. `WatermelonObservable`
 * bridges the two without depending on rxjs:
 *
 * - `subscribe()` accepts a `next` function or an observer object and returns
 *   a subscription with `unsubscribe()` and `closed`. The subscription is
 *   also callable, so the core hooks (`useObservable`, …) accept it as an
 *   `Unsubscribe`.
 * - `[Symbol.observable]()` / `'@@observable'()` return the observable
 *   itself, so `rxjs.from(observable)` and the rxjs `Subscribable<T>` type
 *   both work.
 * - Sources that are only available asynchronously (after the database is
 *   ready) are supported via `WatermelonObservable.defer()`.
 */

import type { Observable, Listener, Unsubscribe } from '../observable/Subject';
import { logger } from '../utils';

declare global {
  interface SymbolConstructor {
    /** Interop symbol — the same declaration rxjs ships, so both can coexist. */
    readonly observable: symbol;
  }
}

export interface WatermelonObserver<T> {
  next?: (value: T) => void;
  error?: (error: unknown) => void;
  complete?: () => void;
}

/** rxjs `Unsubscribable` that is also callable (a core `Unsubscribe`). */
export interface WatermelonSubscription {
  (): void;
  unsubscribe(): void;
  readonly closed: boolean;
}

export type ObserverOrNext<T> = Listener<T> | WatermelonObserver<T>;

/** Producer: receives a guarded observer and returns its teardown. */
export type WatermelonProducer<T> = (observer: Required<WatermelonObserver<T>>) => Unsubscribe;

const observableSymbol: symbol | string =
  (typeof Symbol === 'function' && Symbol.observable) || '@@observable';

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- rxjs interop keys, see below
export class WatermelonObservable<T> {
  readonly #producer: WatermelonProducer<T>;

  constructor(producer: WatermelonProducer<T>) {
    this.#producer = producer;
  }

  /** Wrap a core observable that is available right now. */
  static from<T>(source: Observable<T>): WatermelonObservable<T> {
    return new WatermelonObservable<T>((observer) => source.subscribe(observer.next));
  }

  /**
   * Wrap a core observable created lazily — typically after the database is
   * ready. The factory runs once, on the first subscription, and its result
   * is shared by every subscriber (like the core `SharedObservable`).
   */
  static defer<T>(
    factory: () => Observable<T> | Promise<Observable<T>>,
  ): WatermelonObservable<T> {
    let shared: Observable<T> | Promise<Observable<T>> | null = null;
    return new WatermelonObservable<T>((observer) => {
      let inner: Unsubscribe | null = null;
      let cancelled = false;
      const attach = (source: Observable<T>) => {
        if (!cancelled) inner = source.subscribe(observer.next);
      };
      shared ??= factory();
      if (isPromiseLike(shared)) {
        shared.then(attach, (error: unknown) => {
          if (!cancelled) observer.error(error);
        });
      } else {
        attach(shared);
      }
      return () => {
        cancelled = true;
        inner?.();
        inner = null;
      };
    });
  }

  subscribe(observerOrNext?: ObserverOrNext<T>): WatermelonSubscription {
    const observer = toObserver(observerOrNext);
    let closed = false;
    let teardown: Unsubscribe | null = null;
    let started = false;

    const close = () => {
      if (closed) return;
      closed = true;
      const fn = teardown;
      teardown = null;
      fn?.();
    };

    const guarded: Required<WatermelonObserver<T>> = {
      next: (value) => {
        if (!closed) observer.next?.(value);
      },
      error: (error) => {
        if (closed) return;
        close();
        if (observer.error) observer.error(error);
        else logger.error('Unhandled error in observable subscription', error);
      },
      complete: () => {
        if (closed) return;
        close();
        observer.complete?.();
      },
    };

    const fn = this.#producer(guarded);
    started = true;
    if (closed) {
      // The producer errored/completed synchronously — run its teardown now.
      fn();
    } else {
      teardown = fn;
    }

    const subscription = (() => close()) as WatermelonSubscription;
    Object.defineProperties(subscription, {
      unsubscribe: { value: close },
      closed: { get: () => closed },
      started: { value: started },
    });
    return subscription;
  }
}

// rxjs interop. Defined on the prototype so the key is whatever the runtime
// has — `Symbol.observable` when polyfilled, `'@@observable'` otherwise — and
// both are always present. (Declaration merging only adds these two methods.)
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface WatermelonObservable<T> {
  [Symbol.observable](): WatermelonObservable<T>;
  '@@observable'(): WatermelonObservable<T>;
}

function interop<T>(this: WatermelonObservable<T>): WatermelonObservable<T> {
  return this;
}
Object.defineProperty(WatermelonObservable.prototype, '@@observable', { value: interop });
if (observableSymbol !== '@@observable') {
  Object.defineProperty(WatermelonObservable.prototype, observableSymbol, { value: interop });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function toObserver<T>(observerOrNext?: ObserverOrNext<T>): WatermelonObserver<T> {
  if (!observerOrNext) return {};
  if (typeof observerOrNext === 'function') return { next: observerOrNext };
  return observerOrNext;
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T>).then === 'function';
}

/**
 * Subscribe to a core `Subject`-backed stream, skipping the last value it
 * replays synchronously on subscribe (a stale change event).
 */
export function subscribeToFutureValues<T>(
  source: Observable<T>,
  listener: Listener<T>,
): Unsubscribe {
  let live = false;
  const unsubscribe = source.subscribe((value) => {
    if (live) listener(value);
  });
  live = true;
  return unsubscribe;
}
