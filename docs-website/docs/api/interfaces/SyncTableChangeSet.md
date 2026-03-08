[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / SyncTableChangeSet

# Interface: SyncTableChangeSet

Changes for a single table

## Properties

### created

> **created**: [`RawRecord`](RawRecord.md)[]

Records newly created on the source side.

***

### deleted

> **deleted**: `string`[]

Record ids deleted on the source side.

***

### updated

> **updated**: [`RawRecord`](RawRecord.md)[]

Existing records updated on the source side.
