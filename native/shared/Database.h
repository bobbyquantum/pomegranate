/**
 * PomegranateDB — JSI Database Bridge.
 *
 * Exposes a `nativePomegranateCreateAdapter` global function to JS.
 * When called, creates a C++ SQLite database and returns a JSI object
 * with methods: open, execute, query, executeBatch, close.
 *
 * This is the core performance layer — all calls are synchronous JSI,
 * no bridge serialization, no async queue.
 */

#pragma once

#include <jsi/jsi.h>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include "Sqlite.h"

namespace pomegranate {

using namespace facebook;

/**
 * Platform-specific functions that must be implemented per-platform
 * (Android, iOS, etc.)
 */
namespace platform {
/** Resolve a database name to an absolute path on disk. */
std::string resolveDatabasePath(const std::string &dbName);

/** Log to the platform console. */
void consoleLog(const std::string &message);
void consoleError(const std::string &message);
}  // namespace platform

/**
 * The JSI database bridge.
 *
 * Calling Database::install(runtime) registers the global factory function.
 * JS calls it to get adapter objects with synchronous database methods.
 */
class Database {
   public:
    Database(jsi::Runtime &rt, const std::string &path);
    ~Database();

    /** Install the global `nativePomegranateCreateAdapter` function. */
    static void install(jsi::Runtime &rt);

    // ─── Database operations ───────────────────────────────────────────

    /** Execute a SQL statement with no return value. */
    void execute(const std::string &sql, const jsi::Array &args, jsi::Runtime &rt);

    /** Execute a query and return rows as an array of objects. */
    jsi::Array query(const std::string &sql, const jsi::Array &args, jsi::Runtime &rt);

    /** Execute multiple statements in a transaction. Returns rows affected. */
    int executeBatch(const jsi::Array &commands, jsi::Runtime &rt);

    /** Close the database. */
    void close();

   private:
    std::unique_ptr<SqliteDb> db_;
    std::mutex mutex_;
    std::unordered_map<std::string, sqlite3_stmt *> stmtCache_;

    /** Get or create a cached prepared statement. */
    sqlite3_stmt *cachedPrepare(const std::string &sql);

    /** Bind JSI arguments to a prepared statement. */
    void bindArgs(sqlite3_stmt *stmt, const jsi::Array &args, jsi::Runtime &rt);

    /** Read a result row into a JSI object. */
    jsi::Object rowToObject(sqlite3_stmt *stmt, jsi::Runtime &rt);

    /** Finalize all cached statements. */
    void clearStmtCache();
};

}  // namespace pomegranate
