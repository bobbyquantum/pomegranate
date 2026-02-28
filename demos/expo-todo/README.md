# Expo Todo Demo

A minimal todo app demonstrating **PomegranateDB** with Expo (web & native).

Shows: schema definition, model classes, CRUD operations, live queries, reactive hooks, and IndexedDB persistence.

## Quick start

```bash
# From repo root
cd demos/expo-todo
npm install
npm run web
```

## Updating pomegranate-db

After making changes to the core library:

```bash
npm run reinstall   # rebuilds, packs, and reinstalls the tarball
```

## Why a tarball?

The demo installs `pomegranate-db` from a `.tgz` file instead of a symlink.
This avoids duplicate React — metro would resolve two copies of `react` if
the library were symlinked (one from `node_modules/` here, one from
`../../node_modules/`). The tarball gives us a clean, flat `node_modules`
identical to what a real consumer would have.
