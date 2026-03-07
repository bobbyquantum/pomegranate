# TODO — PomegranateDB

A running list of outstanding work, grouped by area.

---

## Core / Adapters

- [x] **OpSQLiteDriver** — 17 unit tests in `src/adapters/op-sqlite/__tests__/OpSQLiteDriver.test.ts`
- [x] **NativeSQLiteDriver** — 17 unit tests in `src/adapters/native-sqlite/__tests__/NativeSQLiteDriver.test.ts`
- [x] **Worker adapter tests** — `LokiDispatcher` (12 tests) + `SynchronousWorker` (11 tests) in `src/adapters/loki/worker/__tests__/`
- [x] **ExpoSQLiteDriver web compatibility** — patched for Web/WASM usage via expo-sqlite

## iOS / Native

- [x] **iOS native module** — `native/ios/` with `DatabasePlatformIOS.mm`, `PomegranateJSI.h`, `PomegranateJSI.mm`
- [x] **Podspec** — `PomegranateDB.podspec` with `React-Core`, `React-jsi`, system `sqlite3`
- [x] Port `native/shared/` C++ JSI bindings to iOS build (via podspec `source_files`)
- [x] `native/shared/sqlite3/` amalgamation added; Android CMakeLists paths verified
- [ ] **iosTest app** — create `native/iosTest/` bare RN app and run on iOS Simulator
- [ ] Verify Android JSI bindings compile by running `native/androidTest/` on Android Emulator

## Schema & Migrations

- [ ] **Migration engine** — manual migration steps (`createTable`, `addColumn`, `destroyTable`, `sql`) now work across Loki + SQLite, but automated schema diffing for `addColumn` / `createTable` is still not implemented
- [x] Validate migration steps at adapter level — LokiAdapter + SQLiteAdapter covered by migration tests, including version tracking and backfill behavior

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

- [x] **GitHub Actions** — `.github/workflows/ci.yml` (20 jobs, all green)
  - [x] Lint + type check + format check (ubuntu)
  - [x] Unit tests (`jest`) + Codecov upload (ubuntu)
  - [x] TypeScript build (ubuntu)
  - [x] Podspec lint `--quick` (macos-latest)
  - [x] npm pack dry-run on PR → shared `pack-library` job (ubuntu)
  - [x] npm publish on tag push (`v*`) with provenance (ubuntu)
  - [x] Expo-todo Maestro e2e — Android emulator (API 29, KVM) × 4 adapters (loki-idb, expo-sqlite, op-sqlite, native-sqlite)
  - [x] Expo-todo Maestro e2e — iOS Simulator × 4 adapters (loki-idb, expo-sqlite, op-sqlite, native-sqlite)
  - [x] Bare-RN-todo Maestro e2e — Android emulator × 3 adapters (loki-idb, op-sqlite, native-sqlite)
  - [x] Bare-RN-todo Maestro e2e — iOS Simulator × 3 adapters (loki-idb, op-sqlite, native-sqlite)
  - [x] Web Playwright e2e × 2 adapters (loki-idb, expo-sqlite with WASM)
- [x] Code coverage reporting (Codecov via lcov in CI)
- [x] Maestro diagnostic screenshots at key steps + `onFlowError` handlers in all 8 flows
- [x] macOS-latest runner for all iOS/podspec jobs
- [ ] Full podspec compile check (needs `iosTest` app with pods installed)

## Package / Distribution

- [x] Declare `react-native` as a **peer dependency** (>=0.71.0, optional)
- [x] Add `react` peer dependency range (>=17.0.0, optional)
- [x] Verify subpath exports (`.`, `./expo`, `./expo-plugin`, `./op-sqlite`, `./native-sqlite`) resolve correctly in consuming apps (verified from packed tarball with consumer `require.resolve()`)
- [ ] Publish to npm (currently v0.1.0 local only)

## Documentation

- [ ] API reference (auto-generate from TSDoc)
- [ ] "Getting started" guide for Expo + React Native CLI
- [ ] Sync setup walkthrough
- [ ] Encryption usage guide
- [ ] Migration / schema evolution guide
- [ ] Update `docs-website/` Docusaurus content (many pages are stubs or WatermelonDB carry-overs)

## Demos

- [x] **Expo todo app** (`demos/expo-todo/`) — web + iOS + Android, 4 adapter variants
- [x] **Bare React Native todo app** (`demos/bare-rn-todo/`) — iOS + Android, 3 adapter variants (no Expo deps)
- [ ] **Sync demo** — client + tiny Express/Hono server showing pull/push
- [ ] **Encryption demo** — show encrypted adapter usage
- [ ] **Worker demo** — demonstrate Web Worker mode for heavy queries

## Maestro E2E Flows

*8 flows total across 2 demo apps — all passing on Android emulator + iOS Simulator*

### `demos/expo-todo/maestro/`
- [x] `add-todo.yaml` — add a todo via text input + add button
- [x] `toggle-todo.yaml` — seed data, toggle checkbox, verify state
- [x] `delete-todo.yaml` — seed data, swipe-to-delete, verify removal
- [x] `full-flow.yaml` — full CRUD: add → toggle → delete → verify counts

### `demos/bare-rn-todo/maestro/`
- [x] `add-todo.yaml` — add a todo via text input + add button
- [x] `toggle-todo.yaml` — seed data, toggle checkbox, verify state
- [x] `delete-todo.yaml` — seed data, swipe-to-delete, verify removal
- [x] `full-flow.yaml` — full CRUD: add → toggle → delete → verify counts

## Playwright Web E2E (`demos/expo-todo/e2e/`)

*12 tests — all passing*

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
- [x] Bulk toggle (complete all / uncomplete all)
- [ ] Priority ordering
- [ ] Drag-to-reorder (if added)
- [x] Offline persistence stress test (10 todos added, page reloaded, all verified present)
- [ ] Web Worker mode toggle test

## Testing — Coverage Gaps

- [x] `src/utils/` — utility functions covered by direct unit tests (`src/__tests__/utils.test.ts`), with targeted Jest coverage at 100%
- [ ] `src/observable/` — observation helpers need more edge-case tests
- [ ] Adapter error paths (corrupt DB, full disk, etc.)
- [ ] Concurrent write contention tests

---

_Last updated: 2026-03-07 — utils helpers now have direct unit coverage at 100%, Loki migrations cover `createTable` / `addColumn` / `sql` / `destroyTable`, adapter-level migration tests updated, subpath exports verified from packed tarball consumer install_
