/**
 * PomegranateDB — Native SQLite C++ header.
 *
 * RAII wrapper around sqlite3 database handle.
 * Opens the database on construction, closes on destruction.
 */

#pragma once

#include <string>
#include <sqlite3.h>

namespace pomegranate {

/**
 * RAII SQLite database handle.
 */
class SqliteDb {
   public:
    explicit SqliteDb(const std::string &path);
    ~SqliteDb();

    // Non-copyable
    SqliteDb(const SqliteDb &) = delete;
    SqliteDb &operator=(const SqliteDb &) = delete;

    sqlite3 *getHandle() const { return db_; }

    /** Execute a SQL statement with no results. */
    void execute(const std::string &sql);

    /** Prepare a statement (caller owns the stmt). */
    sqlite3_stmt *prepare(const std::string &sql);

    /** Get the last error message. */
    std::string lastErrorMessage() const;

    /** Get the extended error code. */
    int lastErrorCode() const;

   private:
    sqlite3 *db_ = nullptr;
};

/**
 * RAII wrapper for sqlite3_stmt that resets on destruction.
 */
class SqliteStatement {
   public:
    SqliteStatement(sqlite3_stmt *stmt) : stmt_(stmt) {}
    ~SqliteStatement() {
        if (stmt_) {
            sqlite3_reset(stmt_);
            sqlite3_clear_bindings(stmt_);
        }
    }

    SqliteStatement(const SqliteStatement &) = delete;
    SqliteStatement &operator=(const SqliteStatement &) = delete;

    sqlite3_stmt *get() const { return stmt_; }

   private:
    sqlite3_stmt *stmt_;
};

}  // namespace pomegranate
