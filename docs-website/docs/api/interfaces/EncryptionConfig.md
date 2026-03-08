[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / EncryptionConfig

# Interface: EncryptionConfig

Adapter-agnostic encryption settings supplied by the application.

## Properties

### enabled

> `readonly` **enabled**: `boolean`

Whether encryption is enabled for this database.

***

### keyProvider()

> `readonly` **keyProvider**: () => `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

Async provider for the raw encryption key material.

#### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>
