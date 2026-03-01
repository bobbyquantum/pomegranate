# TODO — PomegranateDB

A running list of outstanding work, grouped by area.

---

## Core / Adapters

- [x] **OpSQLiteDriver** — 17 unit tests in `src/adapters/op-sqlite/__tests__/OpSQLiteDriver.test.ts`
- [x] **NativeSQLiteDriver** — 17 unit tests in `src/adapters/native-sqlite/__tests__/NativeSQLiteDriver.test.ts`
- [x] **Worker adapter tests** — `LokiDispatcher` (12 tests) + `SynchronousWorker` (11 tests) in `src/adapters/loki/worker/__tests__/`

## iOS / Native

- [x] **iOS native module** — `native/ios/` with `DatabasePlatformIOS.mm`, `PomegranateJSI.h`, `PomegranateJSI.mm`
- [x] **Podspec** — `PomegranateDB.podspec` with `React-Core`, `React-jsi`, system `sqlite3`
- [x] Port `native/shared/` C++ JSI bindings to iOS build (via podspec `source_files`)
- [x] `native/shared/sqlite3/` amalgamation added; Android CMakeLists paths verified
- [ ] **iosTest app** — create `native/iosTest/` bare RN app and run on iOS Simulator
- [ ] Verify Android JSI bindings compile by running `native/androidTest/` on Android Emulator

## Schema & Migrations

- [ ] **Migration engine** — schema migration types exist but no automated `addColumn` / `createTable` diffing yet
- [ ] Validate migration steps at adapter level (LokiAdapter does a basic version check; SQLite adapters need the same)

## Sync

- [ ] **SyncState / SyncLog observables** — `SyncState` and `SyncLog` types are defined but the observable/streaming API is not wired up
- [ ] End-to-end sync integration test against a mock server
- [ ] Conflict resolution documentation

## Hooks

- [x] **Unit tests for hooks** — all 10 hooks covered by 35 tests in `src/__tests__/web.test.ts` (jsdom, `@testing-library/react`)

## Encryption

- [ ] Encryption integration tests with LokiAdapter + SQLiteAdapter
- [ ] Key rotation / re-keying API

## Observability / Diagnostics

- [ ] Performance diagnostics module (query timing, cache hit rates)
- [ ] `diagnostics/` folder exists but is thin; flesh out

## CI / CD

- [x] **GitHub Actions** — `.github/workflows/`
  - [x] Lint + type check + format check (ubuntu)
  - [x] Unit tests (`jest`) + Codecov upload (ubuntu)
  - [x] TypeScript build (ubuntu)
  - [x] Demo e2e tests (`playwright`) (ubuntu)
  - [x] Podspec lint `--quick` (macos-15)
  - [x] npm pack dry-run on PR (ubuntu)
  - [x] npm publish on tag push (`v*`) with provenance (ubuntu)
- [x] Code coverage reporting (Codecov via lcov in CI)
- [ ] Full podspec compile check (needs `iosTest` app with pods installed)

## Package / Distribution

- [x] Declare `react-native` as a **peer dependency** (>=0.71.0, optional)
- [x] Add `react` peer dependency range (>=17.0.0, optional)
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
- [ ] **React Native (native) demo** — `native/iosTest/` + `native/androidTest/` apps wired to NativeSQLiteAdapter
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
- [x] Offline persistence stress test (10 todos added, page reloaded, all verified present)
- [ ] Web Worker mode toggle test

## Testing — Coverage Gaps

- [ ] `src/utils/` — utility functions have partial coverage
- [ ] `src/observable/` — observation helpers need more edge-case tests
- [ ] Adapter error paths (corrupt DB, full disk, etc.)
- [ ] Concurrent write contention tests

---

_Last updated: 2026-02-28 — iOS bridge + podspec + sqlite3 + CI/CD + NativeSQLite/OpSQLite tests + peer deps + eslint fix_
