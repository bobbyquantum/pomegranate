[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / SyncPushPayload

# Interface: SyncPushPayload

Payload sent to the push endpoint during a sync run.

## Properties

### changes

> **changes**: [`SyncTableChanges`](../type-aliases/SyncTableChanges.md)

Local changes grouped by table.

***

### lastPulledAt

> **lastPulledAt**: `number`

Last pull timestamp acknowledged by the client.
