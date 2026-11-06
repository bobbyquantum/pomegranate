#!/usr/bin/env bash
# Builds the host-side turbo importer benchmark. Requires ./scripts/setup-sqlite
# and ./scripts/setup-simdjson to have been run.
set -euo pipefail
cd "$(dirname "$0")"
SHARED=../shared
mkdir -p build
if [[ ! -f build/sqlite3.o || $SHARED/sqlite3/sqlite3.c -nt build/sqlite3.o ]]; then
  echo "compiling sqlite3.c…"
  cc -O2 -DSQLITE_THREADSAFE=1 -DSQLITE_OMIT_LOAD_EXTENSION -c "$SHARED/sqlite3/sqlite3.c" -o build/sqlite3.o
fi
if [[ ! -f build/simdjson.o || $SHARED/simdjson/simdjson.cpp -nt build/simdjson.o ]]; then
  echo "compiling simdjson.cpp…"
  c++ -std=c++17 -O2 -I"$SHARED" -c "$SHARED/simdjson/simdjson.cpp" -o build/simdjson.o
fi
echo "compiling importer + bench…"
c++ -std=c++17 -O2 -Wall -Wextra -I"$SHARED" -I"$SHARED/sqlite3" \
  turbo_bench.cpp "$SHARED/SyncJsonImporter.cpp" "$SHARED/SyncJsonStore.cpp" \
  build/sqlite3.o build/simdjson.o -o build/turbo_bench
echo "built build/turbo_bench"
