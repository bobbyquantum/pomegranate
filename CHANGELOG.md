# Changelog

## [1.0.0](https://github.com/bobbyquantum/pomegranate/compare/v0.1.1...v1.0.0) (2026-03-07)


### ⚠ BREAKING CHANGES

* Make encryption imports Snack-safe ([#16](https://github.com/bobbyquantum/pomegranate/issues/16))

### Features

* add sync lifecycle observables ([#14](https://github.com/bobbyquantum/pomegranate/issues/14)) ([e4bcaa2](https://github.com/bobbyquantum/pomegranate/commit/e4bcaa22383754e52ec03009138fdab06b822cc3))
* **demo:** Add bulk toggle action to todo demos ([#8](https://github.com/bobbyquantum/pomegranate/issues/8)) ([2e26b14](https://github.com/bobbyquantum/pomegranate/commit/2e26b1450ba6dfe3f09721f05a18e0927e9ab7a9))


### Bug Fixes

* docs landing page redirect and logo path for baseUrl ([4d04600](https://github.com/bobbyquantum/pomegranate/commit/4d046000154f7bbb89b79c3b7c3b1ddf2dab2be0))
* Make encryption imports Snack-safe ([#16](https://github.com/bobbyquantum/pomegranate/issues/16)) ([696b16f](https://github.com/bobbyquantum/pomegranate/commit/696b16ff8f78e14ee05d41ea73d01f52df787c34))

## v0.1.1

### Demo Apps

- Add benchmark button to all demo apps (bare-rn-todo, expo-todo, expo-go) with shared benchmark suite
- Add runtime adapter picker — switch between adapters without rebuilding
- Extract shared styles, adapter picker, and benchmark logic to `demos/shared/`
- Add error boundary for OPFS lock errors in expo-go web demo
- Drop async adapter modes — only sync adapters in demo apps

### Performance

- Add prepared statement cache to expo-sqlite driver (write operations only, LRU max 50)
- Add SQLite PRAGMAs to expo-sqlite and op-sqlite: `synchronous=NORMAL`, `cache_size=-8000`, `temp_store=MEMORY`, `busy_timeout=5000`
- Add `executeBatchNoTx` to expo-sqlite driver
- Wrap `db.write()` in a single SQLite transaction
- Prevent nested transactions in `batch()` during `writeTransaction`

### Bug Fixes

- Fix database naming per adapter to avoid "database is locked" conflicts
- Fix expo-sqlite missing from web in expo-go demo
- Fix raw sync benchmark guard against missing SharedArrayBuffer on web

### CI / E2E Testing

- Add Maestro e2e test flows: CRUD operations + benchmark runs for all adapters
- Consolidate e2e into single job per platform with adapter matrix loop
- Add benchmark result extraction (iOS log stream + Android logcat) with JSON summary artifacts
- Add `workflow_dispatch` trigger for manual runs
- Fix flaky iOS Maestro tests: driver startup timeout, `extendedWaitUntil` for app startup, app data clearing between runs
- Remove loki-memory from iOS e2e (benchmark crash under stress)

### Publishing

- Add npm trusted publishing workflow with provenance support
- Add `repository` field to package.json

## v0.1.0

- Initial release — fork of WatermelonDB with expo-sqlite, op-sqlite, and native-sqlite adapters
