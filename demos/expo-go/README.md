# PomegranateDB — Expo Go Demo

A minimal todo app that runs **inside Expo Go** with no custom native build.

Uses the `expo-sqlite` adapter, which ships as a built-in module in Expo Go.

## Quick Start

```bash
cd demos/expo-go

# First time: build the library and install deps
npm run reinstall
npm install

# Launch
npx expo start
```

Scan the QR code with **Expo Go** on your iOS or Android device.

## How It Works

```
PomegranateDB (JS)  →  SQLiteAdapter  →  ExpoSQLiteDriver  →  expo-sqlite (built into Expo Go)
```

No C++/JSI bridge, no custom dev client, no `expo prebuild` — just pure JavaScript
talking to the SQLite that already ships inside Expo Go.

## Adapters Comparison

| Adapter | Expo Go | Dev Client | Web | Persistence |
|---------|---------|-----------|-----|-------------|
| **ExpoSQLite** (this demo) | ✅ | ✅ | ❌ | ✅ SQLite |
| LokiAdapter + IndexedDB | ✅ | ✅ | ✅ | ✅ IndexedDB |
| LokiAdapter (memory) | ✅ | ✅ | ✅ | ❌ In-memory |
| Native JSI SQLite | ❌ | ✅ | ❌ | ✅ SQLite (C++) |
