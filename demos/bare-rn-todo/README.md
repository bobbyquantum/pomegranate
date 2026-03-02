# Bare React Native Todo Demo

A minimal **Expo-free** React Native app demonstrating PomegranateDB features:
schema, models, CRUD, live queries, hooks, and reactive observation.

## Adapters

| Adapter | Module | Platforms |
|---------|--------|-----------|
| `loki-memory` | `LokiAdapter` (in-memory) | iOS, Android |
| `op-sqlite` | `SQLiteAdapter` + op-sqlite | iOS, Android |
| `native-sqlite` | `SQLiteAdapter` + JSI bridge | iOS, Android |

Select the adapter via the `ADAPTER` environment variable (inlined at JS
bundle time by `babel-plugin-transform-inline-environment-variables`):

```bash
ADAPTER=op-sqlite npx react-native run-ios
```

## Setup

```bash
# From the repo root:
npm ci && npm run build && npm pack

# In this directory:
npm install
cd ios && pod install && cd ..
npx react-native run-ios
```

## E2E Tests

Maestro flows live in `maestro/` and test basic CRUD operations.
