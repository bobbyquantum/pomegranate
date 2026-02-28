# TODO — PomegranateDB

A running list of outstanding work, grouped by area.

---

## Core / Adapters

- [ ] **OpSQLiteDriver** — implemented but has **no dedicated tests**; add unit + integration tests
- [ ] **NativeSQLiteDriver** — implemented but has **no dedicated tests**; add unit + integration tests
- [ ] **Worker adapter tests** — `LokiDispatcher`, `SynchronousWorker`, `loki.worker.ts` entry point lack dedicated unit tests (tested indirectly through LokiAdapter worker-mode tests)

## iOS / Native

- [ ] **iOS native module** — `native/ios/` directory is **completely missing**; no Objective-C/Swift bridge, no JSI bindings for iOS
- [ ] **Podspec** — no `.podspec` file for CocoaPods / autolinking; required to ship on iOS
- [ ] Port `native/shared/` C++ JSI bindings to iOS build (Xcode project / `CMakeLists.txt`)
- [ ] Verify Android JSI bindings still compile with a real React Native app (`native/android-jsi/`)

## Schema & Migrations

- [ ] **Migration engine** — schema migration types exist but no automated `addColumn` / `createTable` diffing yet
- [ ] Validate migration steps at adapter level (LokiAdapter does a basic version check; SQLite adapters need the same)

## Sync

- [ ] **SyncState / SyncLog observables** — `SyncState` and `SyncLog` types are defined but the observable/streaming API is not wired up
- [ ] End-to-end sync integration test against a mock server
- [ ] Conflict resolution documentation

## Hooks

- [ ] **Unit tests for hooks** — all 10 hooks (`useDatabase`, `useLiveQuery`, `useCount`, `useCollection`, etc.) have **zero** dedicated unit tests

## Encryption

- [ ] Encryption integration tests with LokiAdapter + SQLiteAdapter
- [ ] Key rotation / re-keying API

## Observability / Diagnostics

- [ ] Performance diagnostics module (query timing, cache hit rates)
- [ ] `diagnostics/` folder exists but is thin; flesh out

## CI / CD

- [ ] **GitHub Actions** — no `.github/workflows/` at all
  - [ ] Lint + type check
  - [ ] Unit tests (`jest`)
  - [ ] Demo e2e tests (`playwright`)
  - [ ] npm publish (dry run on PR, real on tag)
- [ ] Code coverage reporting (lcov is generated locally; wire to Codecov / Coveralls)

## Package / Distribution

- [ ] Declare `react-native` as a **peer dependency** (currently missing)
- [ ] Add `react` peer dependency range
- [ ] Verify subpath exports (`.`, `./expo`, `./expo-plugin`, `./op-sqlite`, `./native-sqlite`) resolve correctly in consuming apps
- [ ] Publish to npm (currently v0.1.0 local only)

## Documentation

- [ ] API reference (auto-generate from TSDoc)
- [ ] "Getting started" guide for Expo + React Native CLI
- [ ] Sync setup walkthrough
- [ ] Encryption usage guide
- [ ] Migration / schema evolution guide
- [ ] Update `docs-website/` Docusaurus content (many pages are stubs or WatermelonDB carry-overs)

## Demos

- [x] **Expo web todo app** (`demos/expo-todo/`)
- [ ] **React Native (native) demo** — build & run on iOS Simulator / Android Emulator
- [ ] **Sync demo** — client + tiny Express/Hono server showing pull/push
- [ ] **Encryption demo** — show encrypted adapter usage
- [ ] **Worker demo** — demonstrate Web Worker mode for heavy queries

## E2E Tests (`demos/expo-todo/e2e/`)

*Current: 11 tests (10 passing, 1 needs verification after fix)*

- [x] Renders app title
- [x] Shows empty state
- [x] Adds a todo
- [x] Toggles todo completion
- [x] Deletes a todo
- [x] Shows correct counts
- [x] Seeds sample data
- [x] Filters (All / Active / Done)
- [x] Clears completed todos (bug-fixed: `query()` → `fetch()`)
- [x] Data persists across reload
- [x] Input clears after add
- [x] Empty input rejected
- [ ] Bulk toggle (complete all / uncomplete all)
- [ ] Priority ordering
- [ ] Drag-to-reorder (if added)
- [ ] Offline persistence stress test (add 100+ items, reload)
- [ ] Web Worker mode toggle test

## Testing — Coverage Gaps

- [ ] `src/utils/` — utility functions have partial coverage
- [ ] `src/observable/` — observation helpers need more edge-case tests
- [ ] Adapter error paths (corrupt DB, full disk, etc.)
- [ ] Concurrent write contention tests

---

_Last updated: 2026-02-28_
