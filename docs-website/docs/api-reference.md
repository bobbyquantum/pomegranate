---
title: API Reference
slug: /api-reference
---

The API reference in this section is generated directly from the public TypeScript surface exported by `src/index.ts`.

Use it when you want exact signatures, type definitions, and exported class or function details without reading the source by hand.

## What Is Included

- Core schema and model APIs
- Database and collection exports
- Query builder types and helpers
- Storage adapters and driver types
- Sync state and sync helpers
- Observable primitives and React hooks

## How It Is Generated

Run the following from the repository root:

```bash
npm run docs:api
```

That command runs TypeDoc against the public entrypoint and writes Markdown files into `docs-website/docs/api/`, which are then picked up by Docusaurus automatically.
