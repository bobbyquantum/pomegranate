[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / SQLiteDriver

# Interface: SQLiteDriver

Minimal driver interface that wraps any SQLite library.

Implementations:
 - For React Native: wrap react-native-quick-sqlite or op-sqlite
 - For Web: wrap sql.js
 - For Node tests: wrap better-sqlite3

## Methods

### close()

> **close**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### execute()

> **execute**(`sql`, `bindings?`): `Promise`\<`void`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sql` | `string` |
| `bindings?` | `unknown`[] |

#### Returns

`Promise`\<`void`\>

***

### executeAsync()?

> `optional` **executeAsync**(`sql`, `bindings?`): `Promise`\<`void`\>

Optional: explicitly async execute, always going through the async path
even when the driver is configured for sync mode.
Used by benchmarks to measure async overhead.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sql` | `string` |
| `bindings?` | `unknown`[] |

#### Returns

`Promise`\<`void`\>

***

### executeBatch()?

> `optional` **executeBatch**(`commands`): `Promise`\<`void`\>

Optional: execute multiple statements in a single native call.
When provided, SQLiteAdapter.batch() will prefer this over
looping individual execute() calls inside a transaction.

Each command is a [sql, bindings] tuple. The driver should
execute them atomically (in a single transaction).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `commands` | \[`string`, `unknown`[]\][] |

#### Returns

`Promise`\<`void`\>

***

### executeBatchNoTx()?

> `optional` **executeBatchNoTx**(`commands`): `Promise`\<`void`\>

Optional: like executeBatch but without wrapping in a transaction.
Used when the adapter has already opened a transaction (BEGIN IMMEDIATE)
and we want to run many commands in a single native call without nesting.

If not provided, the adapter falls back to looping individual execute()
calls (still fast for sync drivers, but slow for async-only drivers).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `commands` | \[`string`, `unknown`[]\][] |

#### Returns

`Promise`\<`void`\>

***

### executeInTransaction()

> **executeInTransaction**(`fn`): `Promise`\<`void`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fn` | () => `Promise`\<`void`\> |

#### Returns

`Promise`\<`void`\>

***

### executeSync()?

> `optional` **executeSync**(`sql`, `bindings?`): `void`

Optional: direct synchronous execute, bypassing the async Promise wrapping.
Available on drivers that support JSI sync calls (op-sqlite, native-sqlite,
expo-sqlite in preferSync mode). Used by benchmarks for apples-to-apples
sync-vs-async comparisons.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sql` | `string` |
| `bindings?` | `unknown`[] |

#### Returns

`void`

***

### open()

> **open**(`name`): `Promise`\<`void`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`void`\>

***

### query()

> **query**(`sql`, `bindings?`): `Promise`\<`Record`\<`string`, `unknown`\>[]\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sql` | `string` |
| `bindings?` | `unknown`[] |

#### Returns

`Promise`\<`Record`\<`string`, `unknown`\>[]\>
