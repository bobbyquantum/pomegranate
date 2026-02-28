/**
 * PomegranateDB — Native SQLite C++ implementation.
 */

#include "Sqlite.h"
#include <stdexcept>

namespace pomegranate {

SqliteDb::SqliteDb(const std::string &path) {
    int result = sqlite3_open(path.c_str(), &db_);
    if (result != SQLITE_OK) {
        std::string error = db_ ? sqlite3_errmsg(db_) : "Unknown error";
        if (db_) {
            sqlite3_close(db_);
            db_ = nullptr;
        }
        throw std::runtime_error("Failed to open database: " + error);
    }
}

SqliteDb::~SqliteDb() {
    if (db_) {
        // Finalize any remaining statements
        sqlite3_stmt *stmt = nullptr;
        while ((stmt = sqlite3_next_stmt(db_, nullptr)) != nullptr) {
            sqlite3_finalize(stmt);
        }
        sqlite3_close(db_);
        db_ = nullptr;
    }
}

void SqliteDb::execute(const std::string &sql) {
    char *errMsg = nullptr;
    int result = sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &errMsg);
    if (result != SQLITE_OK) {
        std::string error = errMsg ? errMsg : "Unknown error";
        sqlite3_free(errMsg);
        throw std::runtime_error("SQL execution failed: " + error);
    }
}

sqlite3_stmt *SqliteDb::prepare(const std::string &sql) {
    sqlite3_stmt *stmt = nullptr;
    int result = sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt, nullptr);
    if (result != SQLITE_OK) {
        throw std::runtime_error("Failed to prepare statement: " + std::string(sqlite3_errmsg(db_)) + " SQL: " + sql);
    }
    return stmt;
}

std::string SqliteDb::lastErrorMessage() const {
    return db_ ? sqlite3_errmsg(db_) : "No database";
}

int SqliteDb::lastErrorCode() const {
    return db_ ? sqlite3_extended_errcode(db_) : 0;
}

}  // namespace pomegranate
