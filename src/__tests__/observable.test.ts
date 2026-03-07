/**
 * Tests for Observable primitives.
 */

import {
  Subject,
  BehaviorSubject,
  SharedObservable,
  mapObservable,
  combineObservables,
} from '../observable';

describe('Subject', () => {
  it('notifies subscribers', () => {
    const subject = new Subject<number>();
    const values: number[] = [];

    subject.subscribe((v) => values.push(v));
    subject.next(1);
    subject.next(2);
    subject.next(3);

    expect(values).toEqual([1, 2, 3]);
  });

  it('supports unsubscribe', () => {
    const subject = new Subject<number>();
    const values: number[] = [];

    const unsub = subject.subscribe((v) => values.push(v));
    subject.next(1);
    unsub();
    subject.next(2);

    expect(values).toEqual([1]);
  });

  it('supports multiple subscribers', () => {
    const subject = new Subject<string>();
    const a: string[] = [];
    const b: string[] = [];

    subject.subscribe((v) => a.push(v));
    subject.subscribe((v) => b.push(v));
    subject.next('hello');

    expect(a).toEqual(['hello']);
    expect(b).toEqual(['hello']);
  });

  it('tracks subscriber count', () => {
    const subject = new Subject<number>();
    expect(subject.subscriberCount).toBe(0);

    const unsub1 = subject.subscribe(() => {});
    expect(subject.subscriberCount).toBe(1);

    const unsub2 = subject.subscribe(() => {});
    expect(subject.subscriberCount).toBe(2);

    unsub1();
    expect(subject.subscriberCount).toBe(1);

    unsub2();
    expect(subject.subscriberCount).toBe(0);
  });

  it('treats an explicit undefined initial value as a replayable value', () => {
    const subject = new Subject<number | undefined>(undefined);
    const values: Array<number | undefined> = [];

    subject.subscribe((v) => values.push(v));

    expect(subject.hasValue).toBe(true);
    expect(subject.lastValue).toBeUndefined();
    expect(values).toEqual([undefined]);
  });
});

describe('BehaviorSubject', () => {
  it('emits initial value to new subscribers', () => {
    const subject = new BehaviorSubject<number>(42);
    const values: number[] = [];

    subject.subscribe((v) => values.push(v));

    expect(values).toEqual([42]);
    expect(subject.value).toBe(42);
  });

  it('emits latest value to late subscribers', () => {
    const subject = new BehaviorSubject<number>(0);
    subject.next(10);

    const values: number[] = [];
    subject.subscribe((v) => values.push(v));

    expect(values).toEqual([10]);
  });
});

describe('SharedObservable', () => {
  it('starts producer on first subscribe and tears down on last unsubscribe', () => {
    let started = false;
    let tornDown = false;

    const shared = new SharedObservable<number>((emit) => {
      started = true;
      emit(42);
      return () => {
        tornDown = true;
      };
    });

    expect(started).toBe(false);

    const unsub = shared.subscribe(() => {});
    expect(started).toBe(true);

    unsub();
    expect(tornDown).toBe(true);
  });

  it('replays last value to new subscribers', () => {
    let emitFn: ((v: number) => void) | null = null;

    const shared = new SharedObservable<number>((emit) => {
      emitFn = emit;
      emit(1);
      return () => {};
    });

    const values1: number[] = [];
    shared.subscribe((v) => values1.push(v));
    expect(values1).toEqual([1]);

    emitFn!(2);

    const values2: number[] = [];
    shared.subscribe((v) => values2.push(v));
    expect(values2).toEqual([2]); // gets replayed latest value
  });

  it('shares one producer across concurrent subscribers and waits for the last unsubscribe', () => {
    let starts = 0;
    let teardowns = 0;
    let emitFn: ((value: number) => void) | null = null;

    const shared = new SharedObservable<number>((emit) => {
      starts += 1;
      emitFn = emit;
      emit(starts);

      return () => {
        teardowns += 1;
      };
    });

    const values1: number[] = [];
    const values2: number[] = [];

    const unsub1 = shared.subscribe((v) => values1.push(v));
    const unsub2 = shared.subscribe((v) => values2.push(v));

    expect(starts).toBe(1);
    expect(values1).toEqual([1]);
    expect(values2).toEqual([1]);

    emitFn!(5);
    expect(values1).toEqual([1, 5]);
    expect(values2).toEqual([1, 5]);

    unsub1();
    expect(teardowns).toBe(0);

    unsub2();
    expect(teardowns).toBe(1);
  });

  it('restarts the producer after all subscribers disconnect', () => {
    let starts = 0;
    let teardowns = 0;

    const shared = new SharedObservable<number>((emit) => {
      starts += 1;
      emit(starts);

      return () => {
        teardowns += 1;
      };
    });

    const values1: number[] = [];
    const unsub1 = shared.subscribe((v) => values1.push(v));

    unsub1();

    const values2: number[] = [];
    const unsub2 = shared.subscribe((v) => values2.push(v));

    expect(starts).toBe(2);
    expect(teardowns).toBe(1);
    expect(values1).toEqual([1]);
    expect(values2).toEqual([2]);

    unsub2();
    expect(teardowns).toBe(2);
  });
});

describe('mapObservable', () => {
  it('transforms values', () => {
    const subject = new Subject<number>();
    const doubled = mapObservable(subject, (v) => v * 2);

    const values: number[] = [];
    doubled.subscribe((v) => values.push(v));

    subject.next(3);
    subject.next(5);

    expect(values).toEqual([6, 10]);
  });

  it('unsubscribes from the source when the mapped subscription is disposed', () => {
    let sourceSubscribers = 0;
    let sourceUnsubscribes = 0;

    const source = {
      subscribe(listener: (value: number) => void) {
        sourceSubscribers += 1;
        listener(3);

        return () => {
          sourceUnsubscribes += 1;
        };
      },
    };

    const mapped = mapObservable(source, (value) => value * 2);
    const values: number[] = [];

    const unsub = mapped.subscribe((value) => values.push(value));
    unsub();

    expect(sourceSubscribers).toBe(1);
    expect(sourceUnsubscribes).toBe(1);
    expect(values).toEqual([6]);
  });
});

describe('combineObservables', () => {
  it('combines multiple observables', () => {
    const a = new BehaviorSubject<number>(1);
    const b = new BehaviorSubject<number>(2);

    const combined: number[][] = [];
    combineObservables([a, b]).subscribe((v) => combined.push(v));

    // Both have initial values, so combined emits twice (once for each subscription)
    // but we only get complete arrays once both have emitted
    expect(combined.length).toBe(1);
    expect(combined[0]).toEqual([1, 2]);

    a.next(10);
    expect(combined.at(-1)).toEqual([10, 2]);
  });

  it('waits until every source has emitted before producing a combined value', () => {
    const a = new Subject<number>();
    const b = new Subject<number>();

    const combined: number[][] = [];
    combineObservables([a, b]).subscribe((value) => combined.push(value));

    a.next(1);
    expect(combined).toEqual([]);

    b.next(2);
    expect(combined).toEqual([[1, 2]]);
  });

  it('emits an empty array immediately when combining no sources', () => {
    const combined: number[][] = [];

    combineObservables<number>([]).subscribe((value) => combined.push(value));

    expect(combined).toEqual([[]]);
  });

  it('unsubscribes from every source when the combined subscription is disposed', () => {
    const unsubscribed: string[] = [];

    const first = {
      subscribe(listener: (value: number) => void) {
        listener(1);
        return () => unsubscribed.push('first');
      },
    };

    const second = {
      subscribe(listener: (value: number) => void) {
        listener(2);
        return () => unsubscribed.push('second');
      },
    };

    const unsub = combineObservables([first, second]).subscribe(() => {});
    unsub();

    expect(unsubscribed).toEqual(['first', 'second']);
  });
});
