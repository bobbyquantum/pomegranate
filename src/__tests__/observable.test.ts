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
});
