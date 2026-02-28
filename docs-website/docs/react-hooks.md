---
sidebar_position: 8
title: React Hooks
slug: /react-hooks
---

# React Hooks

PomegranateDB provides first-class React hooks for reactive data binding. When data changes in the database, your components re-render automatically.

## Setup

Wrap your app with `DatabaseProvider`:

```tsx
import { DatabaseProvider } from 'pomegranate-db';

function App() {
  return (
    <DatabaseProvider value={db}>
      <YourApp />
    </DatabaseProvider>
  );
}
```

## `useLiveQuery`

Subscribe to a live query that updates when matching records change:

```tsx
import { useLiveQuery } from 'pomegranate-db';

function PostList() {
  const { results: posts, isLoading } = useLiveQuery(Post, (q) =>
    q.where('status', 'published').orderBy('created_at', 'desc'),
  );

  if (isLoading) return <Text>Loading...</Text>;

  return posts.map((post) => (
    <Text key={post.id}>{post.title}</Text>
  ));
}
```

The query function receives a `QueryBuilder` — use all the same operators as regular queries.

## `useById`

Fetch and observe a single record by ID:

```tsx
import { useById } from 'pomegranate-db';

function PostDetail({ postId }: { postId: string }) {
  const { record: post, isLoading } = useById(Post, postId);

  if (isLoading) return <Text>Loading...</Text>;
  if (!post) return <Text>Not found</Text>;

  return <Text>{post.title}</Text>;
}
```

Updates to the record automatically trigger a re-render.

## `useField`

Observe a specific field of a record:

```tsx
import { useField } from 'pomegranate-db';

function StatusBadge({ post }: { post: Post }) {
  const status = useField(post, 'status');
  return <Text>Status: {status}</Text>;
}
```

## `useSearch`

Full-text search with debouncing:

```tsx
import { useSearch } from 'pomegranate-db';

function SearchBar() {
  const [query, setQuery] = useState('');
  const { results, isLoading, totalCount } = useSearch(Post, {
    query,
    columns: ['title', 'body'],
    limit: 20,
    debounceMs: 300,
  });

  return (
    <>
      <TextInput value={query} onChangeText={setQuery} />
      {isLoading && <Text>Searching...</Text>}
      <Text>{totalCount} results</Text>
      {results.map((post) => (
        <Text key={post.id}>{post.title}</Text>
      ))}
    </>
  );
}
```

## `useCount`

Observe the count of matching records:

```tsx
import { useCount } from 'pomegranate-db';

function DraftCount() {
  const count = useCount(Post, (q) => q.where('status', 'draft'));
  return <Text>{count} drafts</Text>;
}
```

## `useDatabase` / `useCollection`

Access the database or a collection from context:

```tsx
import { useDatabase, useCollection } from 'pomegranate-db';

function MyComponent() {
  const db = useDatabase();
  const postsCollection = useCollection(Post);

  const handleCreate = async () => {
    await db.write(async () => {
      await postsCollection.create({ title: 'New Post' });
    });
  };
}
```

## `useObservable`

Low-level hook for subscribing to any `Observable`:

```tsx
import { useObservable } from 'pomegranate-db';

function MyComponent({ post }: { post: Post }) {
  const value = useObservable(post.observe());
  return <Text>{value?.title}</Text>;
}
```
