---
sidebar_position: 11
title: Contributing
slug: /contributing
---

# Contributing

Thank you for your interest in contributing to PomegranateDB!

## Development Setup

```bash
git clone https://github.com/bobbyquantum/pomegranate.git
cd pomegranate
npm install
```

## Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Specific test file
npx jest src/query/__tests__/QueryBuilder.test.ts
```

We currently have **401 tests across 20 suites** covering schema, models, queries, CRUD, sync, hooks, encryption, adapters, and more.

## Project Structure

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

## Android Development

Requirements: JDK 21, Android SDK 36, NDK 27.1.12297006

```bash
# Build the Android test app
cd native/androidTest
./gradlew assembleDebug

# Run integration tests (requires emulator)
npm run test:android
```

## Code Style

- TypeScript strict mode
- No decorators or Babel transforms
- Prefer explicit types over `any`
- Pure functions where possible
- All public APIs should have JSDoc comments

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Add tests for any new functionality
3. Ensure all tests pass: `npm test`
4. Ensure TypeScript checks pass: `npm run lint`
5. Submit a PR with a clear description
