---
sidebar_position: 9
title: Observation
slug: /observation
---

# Observation

PomegranateDB has a built-in observable system for reactive data access. This powers the React hooks and enables custom reactive patterns.

## Observable Primitives

### Subject

A simple observable that emits values to subscribers:

```ts
import { Subject } from 'pomegranate-db';

const subject = new Subject<string>();

const unsub = subject.subscribe((value) => {
  console.log('Received:', value);
});

subject.next('hello');  // logs: "Received: hello"
subject.next('world');  // logs: "Received: world"

unsub();  // stop listening
```

### BehaviorSubject

Like Subject, but remembers and immediately emits the last value to new subscribers:

```ts
import { BehaviorSubject } from 'pomegranate-db';

const subject = new BehaviorSubject<number>(0);

subject.next(42);

subject.subscribe((value) => {
  console.log(value);  // immediately logs: 42
});
```

### SharedObservable

An observable that shares a single subscription among all observers, with automatic cleanup:

```ts
import { SharedObservable } from 'pomegranate-db';

const shared = new SharedObservable<Post[]>((emit) => {
  // This setup function runs once when the first subscriber connects
  const interval = setInterval(async () => {
    const posts = await fetchPosts();
    emit(posts);
  }, 5000);

  // Return cleanup function
  return () => clearInterval(interval);
});

// First subscription starts the interval
const unsub1 = shared.subscribe(console.log);
// Second subscription shares the same interval
const unsub2 = shared.subscribe(console.log);

// Last unsubscribe cleans up
unsub1();
unsub2();  // interval is cleared
```

## Record Observation

Every model instance can be observed:

```ts
const unsub = post.observe().subscribe((updatedPost) => {
  console.log('Post changed:', updatedPost.title);
});
```

## Field Observation

Watch a specific field for changes:

```ts
post.observeField('status').subscribe((status) => {
  console.log('Status:', status);
});
```

## Query Observation

Live queries that re-evaluate when data changes:

```ts
const observable = db.get(Post)
  .query()
  .where('status', 'published')
  .observe();

observable.subscribe((posts) => {
  console.log('Published posts:', posts.length);
});
```

Live queries emit once on subscribe and then only when the matching record ids (or their order) change. Pass `{ columns: [...] }` to `observeQuery` — or use `observeQueryWithColumns` — to also emit when those columns change on a matched record. Updates that cannot affect the result are filtered out before the query is re-run; see [Queries](./queries#observing-queries).

## Collection Observation

Watch all changes in a collection:

```ts
db.get(Post).changes$.subscribe((change) => {
  console.log(change.type, change.record.id, change.columns);
  // type: 'created' | 'updated' | 'deleted'
  // columns: the column names changed by an update (absent for created/deleted
  //          and for batch/sync notifications)
});
```

## Using with React

The observation system integrates directly with React via hooks. See [React Hooks](./react-hooks) for details.
