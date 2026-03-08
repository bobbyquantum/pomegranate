[**pomegranate-db**](../index.md)

***

[pomegranate-db](../index.md) / ComparisonOperator

# Type Alias: ComparisonOperator

> **ComparisonOperator** = `"eq"` \| `"neq"` \| `"gt"` \| `"gte"` \| `"lt"` \| `"lte"` \| `"in"` \| `"notIn"` \| `"like"` \| `"notLike"` \| `"between"` \| `"isNull"` \| `"isNotNull"`

Query descriptor types.

Queries are built as plain descriptor objects (no classes), making them
serializable and easy to translate to SQL or LokiJS query syntax.
