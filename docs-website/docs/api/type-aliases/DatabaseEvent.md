[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / DatabaseEvent

# Type Alias: DatabaseEvent

> **DatabaseEvent** = \{ `type`: `"initialized"`; \} \| \{ `type`: `"write_started"`; \} \| \{ `type`: `"write_completed"`; \} \| \{ `type`: `"sync_started"`; \} \| \{ `type`: `"sync_completed"`; \} \| \{ `error`: `string`; `type`: `"sync_failed"`; \} \| \{ `type`: `"reset"`; \}
