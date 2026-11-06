/**
 * PomegranateDB — Turbo sync JSON importer.
 *
 * Parses a sync pull payload
 *
 *   { "changes": { "<table>": { "created": [...], "updated": [...], "deleted": ["id", …] } },
 *     "timestamp": 1700000000000 }
 *
 * with simdjson's streaming (On-Demand) API and writes it into SQLite inside a
 * single transaction, without ever materialising the document as JS objects.
 *
 * Semantics match the JS `applyRemoteChanges` path used by `performSync`:
 *   - created/updated rows are written with INSERT OR REPLACE and land as
 *     `_status = 'synced'`, `_changed = ''` regardless of what the payload says
 *   - deleted ids are removed with DELETE
 *   - nested objects/arrays in a column are stored as their raw JSON text
 *
 * When a schema is supplied, tables the schema does not know are skipped and
 * columns the schema does not know are dropped (both are counted in the
 * stats), so a server that sends extra fields cannot break the import.
 *
 * This file has no JSI dependency so it can be unit-tested and benchmarked
 * with a plain host compiler.
 */

#pragma once

#include <sqlite3.h>

#include <cstdint>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace pomegranate {
namespace syncjson {

/** table name -> allowed column names (excluding id/_status/_changed). */
using TableColumns = std::unordered_map<std::string, std::unordered_set<std::string>>;

struct ImportStats {
    bool hasTimestamp = false;
    double timestamp = 0;
    std::int64_t tables = 0;
    std::int64_t inserted = 0;
    std::int64_t deleted = 0;
    std::int64_t skippedTables = 0;
    std::int64_t skippedColumns = 0;
};

/**
 * Import `json` into `db`.
 *
 * `json` is taken by reference because simdjson needs `kPadding` spare bytes
 * of capacity after the payload; the function reserves them if missing (which
 * may reallocate). The string content is not modified.
 *
 * Throws std::runtime_error on malformed JSON, unsafe identifiers, or SQLite
 * failure. The transaction is rolled back before the exception propagates.
 */
ImportStats importSyncJson(sqlite3 *db, std::string &json, const TableColumns *schema);

}  // namespace syncjson
}  // namespace pomegranate
