---
sidebar_position: 11
title: Contributing
slug: /contributing
---

# Contributing

Thank you for your interest in contributing to PomegranateDB!

## Development setup

```bash
git clone https://github.com/bobbyquantum/pomegranate.git
cd pomegranate
npm install
```

## Core commands

```bash
# Build the library
npm run build

# Type-check + lint
npm run check

# Jest test suite
npm test

# Build the docs site
npm run docs:build
```

Use focused checks while iterating, then run the broader command set that matches the files you changed.

## Running tests

```bash
# All Jest tests
npm test

# Watch mode
npm run test:watch

# Target a specific file or pattern
npx jest src/__tests__/integration.test.ts
npx jest --testPathPattern='web\\.test'
```

The repository includes unit tests, integration tests, React hook coverage, web-focused tests, and native validation flows. Avoid hard-coding test counts in docs or PRs because they change frequently.

## Project structure

```
src/
  adapters/           # Storage adapters (Loki, SQLite, Expo, op-sqlite, native-jsi)
  collection/         # Collection class — query interface for a model
  database/           # Database class — central coordinator
  encryption/         # EncryptingAdapter and EncryptionManager
  hooks/              # React hooks (useLiveQuery, useById, etc.)
  model/              # Model base class
  observable/         # Subject, BehaviorSubject, SharedObservable
  query/              # QueryBuilder and SQL generation
  schema/             # Schema builder (m.model, m.text, etc.)
  sync/               # Pull/push sync engine
  utils/              # Logger, ID generation, helpers
  integrationTests/   # Platform-agnostic integration test suite

native/
  shared/             # C++ code shared across platforms (Sqlite.h/cpp, Database.h/cpp)
  android-jsi/        # Android JNI bridge and CMake build
  androidTest/        # React Native Android test app
  expoTest/           # Expo test app

docs-website/         # This documentation site (Docusaurus)
```

## Native development

Android requirements currently include JDK 21, Android SDK 36, and NDK 27.1.12297006.

```bash
# Build the Android test app
cd native/androidTest
./gradlew assembleDebug

# Run integration tests (requires emulator)
npm run test:android
```

There is also an Expo-native validation path:

```bash
npm run test:android:expo
```

If your change touches iOS, Android, Expo, packaging, or native SQLite code, call that out in the PR and run the narrowest realistic local validation you can.

## Documentation changes

If you change public APIs, adapter behavior, installation requirements, or workflow guidance:

- update the matching page under `docs-website/docs/`
- rebuild the docs site with `npm run docs:build`
- prefer examples that use public APIs only

## Code style

- TypeScript strict mode
- No decorators or Babel transforms
- Prefer explicit types over `any`
- Pure functions where possible
- Keep docs and code examples aligned with the shipped package exports
- Add or update JSDoc on public APIs when behavior changes

## Pull request checklist

1. Fork the repo and create a branch from `main`
2. Add tests for any new functionality
3. Run the focused local checks that cover your change
4. Run broader validation when the change touches shared surfaces
5. Update docs when the public behavior changes
6. Submit a PR with a clear description, tradeoffs, and any follow-up work

Strong pull requests in this repo tend to be small, well-scoped, and backed by concrete validation results. If something could not be tested locally, say so explicitly in the PR body.
