[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / DatabaseSuspenseProvider

# Function: DatabaseSuspenseProvider()

> **DatabaseSuspenseProvider**(`__namedParameters`): `ReactNode`

A Suspense-compatible database provider.

Creates and initializes a Database, suspending the component tree until
the database is ready. Wrap with `<Suspense fallback={...}>` to show
a loading state.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | [`DatabaseSuspenseProviderProps`](../interfaces/DatabaseSuspenseProviderProps.md) |

## Returns

`ReactNode`

## Example

```tsx
import { Suspense } from 'react';
import { DatabaseSuspenseProvider, useLiveQuery } from 'pomegranate-db';

function App() {
  return (
    <Suspense fallback={<Text>Preparing database...</Text>}>
      <DatabaseSuspenseProvider
        adapter={new LokiAdapter({ databaseName: 'myapp' })}
        models={[Post, Comment]}
      >
        <MyApp />
      </DatabaseSuspenseProvider>
    </Suspense>
  );
}
```
