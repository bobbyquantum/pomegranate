[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / ExpoSQLiteDriverConfig

# Interface: ExpoSQLiteDriverConfig

## Properties

### openOptions?

> `optional` **openOptions**: `object`

Options passed to expo-sqlite's openDatabaseAsync/openDatabaseSync.

#### enableChangeListener?

> `optional` **enableChangeListener**: `boolean`

#### Default

```ts
{}
```

***

### preferSync?

> `optional` **preferSync**: `boolean`

When true, use synchronous JSI calls (runSync, getAllSync, etc.)
for better performance on native platforms.

On web (wa-sqlite), sync methods are not available — the driver
will automatically fall back to async mode.

#### Default

```ts
false
```
