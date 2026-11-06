/**
 * PomegranateDB — host benchmark / smoke test for the turbo sync importer.
 *
 * Usage:
 *   turbo_bench <create.sql> <columns.json> <bundle.json> <out.db>
 *
 *   create.sql    CREATE TABLE statements for the target schema
 *   columns.json  { "<table>": ["col", …], … } — allowed columns per table
 *   bundle.json   a sync pull payload { changes: {...}, timestamp }
 *   out.db        SQLite file to (re)create
 *
 * Prints timings and per-table row counts so the result can be checked
 * against the generator's expectations.
 */

#include <sqlite3.h>

#include <chrono>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include "SyncJsonImporter.h"
#include "simdjson/simdjson.h"

using namespace pomegranate::syncjson;

static std::string readFile(const char *path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw std::runtime_error(std::string("cannot open ") + path);
    }
    std::ostringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

static double millisSince(std::chrono::steady_clock::time_point start) {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
}

int main(int argc, char **argv) {
    if (argc < 5) {
        std::cerr << "usage: turbo_bench <create.sql> <columns.json> <bundle.json> <out.db>\n";
        return 2;
    }
    try {
        std::string createSql = readFile(argv[1]);
        std::string columnsJson = readFile(argv[2]);

        auto readStart = std::chrono::steady_clock::now();
        std::string bundle = readFile(argv[3]);
        std::printf("read bundle: %.1f MB in %.0f ms\n", bundle.size() / 1048576.0, millisSince(readStart));

        // Allowed columns per table.
        TableColumns schema;
        {
            simdjson::dom::parser parser;
            simdjson::dom::object root = parser.parse(columnsJson);
            for (auto field : root) {
                std::unordered_set<std::string> columns;
                for (auto column : field.value.get_array()) {
                    columns.insert(std::string(std::string_view(column)));
                }
                schema.emplace(std::string(field.key), std::move(columns));
            }
        }

        std::remove(argv[4]);
        sqlite3 *db = nullptr;
        if (sqlite3_open(argv[4], &db) != SQLITE_OK) {
            throw std::runtime_error("cannot open database");
        }
        // Same pragmas as the JSI Database constructor.
        sqlite3_exec(db, "PRAGMA journal_mode = WAL", nullptr, nullptr, nullptr);
        sqlite3_exec(db, "PRAGMA synchronous = NORMAL", nullptr, nullptr, nullptr);
        sqlite3_exec(db, "PRAGMA temp_store = MEMORY", nullptr, nullptr, nullptr);
        sqlite3_exec(db, "PRAGMA cache_size = -8000", nullptr, nullptr, nullptr);

        char *err = nullptr;
        if (sqlite3_exec(db, createSql.c_str(), nullptr, nullptr, &err) != SQLITE_OK) {
            std::string message = err ? err : "unknown";
            sqlite3_free(err);
            throw std::runtime_error("create schema failed: " + message);
        }

        auto importStart = std::chrono::steady_clock::now();
        ImportStats stats = importSyncJson(db, bundle, &schema);
        double importMs = millisSince(importStart);

        std::printf("import: %.0f ms — %lld rows into %lld tables, %lld deleted, %lld cols skipped, %lld tables skipped\n",
                    importMs, static_cast<long long>(stats.inserted), static_cast<long long>(stats.tables),
                    static_cast<long long>(stats.deleted), static_cast<long long>(stats.skippedColumns),
                    static_cast<long long>(stats.skippedTables));
        std::printf("timestamp: %s%.0f\n", stats.hasTimestamp ? "" : "(none) ", stats.timestamp);
        std::printf("throughput: %.0f rows/s, %.1f MB/s\n", stats.inserted / (importMs / 1000.0),
                    bundle.size() / 1048576.0 / (importMs / 1000.0));

        // Per-table counts for verification.
        sqlite3_stmt *tables = nullptr;
        sqlite3_prepare_v2(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", -1, &tables, nullptr);
        long long total = 0;
        while (sqlite3_step(tables) == SQLITE_ROW) {
            std::string table = reinterpret_cast<const char *>(sqlite3_column_text(tables, 0));
            sqlite3_stmt *count = nullptr;
            std::string sql = "SELECT COUNT(*), SUM(_status = 'synced') FROM \"" + table + "\"";
            sqlite3_prepare_v2(db, sql.c_str(), -1, &count, nullptr);
            if (sqlite3_step(count) == SQLITE_ROW) {
                long long rows = sqlite3_column_int64(count, 0);
                long long synced = sqlite3_column_int64(count, 1);
                total += rows;
                std::printf("  %-45s %8lld rows (%lld synced)\n", table.c_str(), rows, synced);
            }
            sqlite3_finalize(count);
        }
        sqlite3_finalize(tables);
        std::printf("total rows in db: %lld\n", total);

        sqlite3_close(db);
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "error: " << error.what() << "\n";
        return 1;
    }
}
