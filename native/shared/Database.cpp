/**
 * PomegranateDB — JSI Database Bridge implementation.
 */

#include "Database.h"
#include <sstream>
#include <vector>

#include "SyncJsonImporter.h"
#include "SyncJsonStore.h"

namespace pomegranate {

using namespace facebook;

// ─── Database lifecycle ──────────────────────────────────────────────────────

Database::Database(jsi::Runtime &rt, const std::string &path) {
    db_ = std::make_unique<SqliteDb>(path);

    // Pragmas for performance
    db_->execute("PRAGMA journal_mode = WAL");
    db_->execute("PRAGMA synchronous = NORMAL");
    db_->execute("PRAGMA busy_timeout = 5000");
    db_->execute("PRAGMA temp_store = MEMORY");
    db_->execute("PRAGMA cache_size = -8000");  // 8 MB

    platform::consoleLog("PomegranateDB: opened " + path);
}

Database::~Database() {
    close();
}

void Database::close() {
    std::lock_guard<std::mutex> lock(mutex_);
    clearStmtCache();
    db_.reset();
}

// ─── Statement cache ─────────────────────────────────────────────────────────

sqlite3_stmt *Database::cachedPrepare(const std::string &sql) {
    auto it = stmtCache_.find(sql);
    if (it != stmtCache_.end()) {
        return it->second;
    }
    sqlite3_stmt *stmt = db_->prepare(sql);
    stmtCache_[sql] = stmt;
    return stmt;
}

void Database::clearStmtCache() {
    for (auto &pair : stmtCache_) {
        sqlite3_finalize(pair.second);
    }
    stmtCache_.clear();
}

// ─── Argument binding ────────────────────────────────────────────────────────

void Database::bindArgs(sqlite3_stmt *stmt, const jsi::Array &args, jsi::Runtime &rt) {
    size_t count = args.size(rt);
    for (size_t i = 0; i < count; i++) {
        jsi::Value val = args.getValueAtIndex(rt, i);
        int idx = static_cast<int>(i) + 1;  // SQLite 1-indexed

        if (val.isNull() || val.isUndefined()) {
            sqlite3_bind_null(stmt, idx);
        } else if (val.isBool()) {
            sqlite3_bind_int(stmt, idx, val.getBool() ? 1 : 0);
        } else if (val.isNumber()) {
            double num = val.getNumber();
            // If it looks like an integer, bind as int for efficiency
            if (num == static_cast<double>(static_cast<int64_t>(num)) && num >= -9007199254740992.0 &&
                num <= 9007199254740992.0) {
                sqlite3_bind_int64(stmt, idx, static_cast<int64_t>(num));
            } else {
                sqlite3_bind_double(stmt, idx, num);
            }
        } else if (val.isString()) {
            std::string str = val.getString(rt).utf8(rt);
            sqlite3_bind_text(stmt, idx, str.c_str(), static_cast<int>(str.size()), SQLITE_TRANSIENT);
        } else {
            throw jsi::JSError(rt, "PomegranateDB: unsupported binding type at index " + std::to_string(i));
        }
    }
}

// ─── Row reading ─────────────────────────────────────────────────────────────

jsi::Object Database::rowToObject(sqlite3_stmt *stmt, jsi::Runtime &rt) {
    jsi::Object obj(rt);
    int columnCount = sqlite3_column_count(stmt);

    for (int i = 0; i < columnCount; i++) {
        const char *name = sqlite3_column_name(stmt, i);
        int type = sqlite3_column_type(stmt, i);

        switch (type) {
            case SQLITE_NULL:
                obj.setProperty(rt, name, jsi::Value::null());
                break;
            case SQLITE_INTEGER:
                obj.setProperty(rt, name, jsi::Value(static_cast<double>(sqlite3_column_int64(stmt, i))));
                break;
            case SQLITE_FLOAT:
                obj.setProperty(rt, name, jsi::Value(sqlite3_column_double(stmt, i)));
                break;
            case SQLITE_TEXT: {
                const char *text = reinterpret_cast<const char *>(sqlite3_column_text(stmt, i));
                obj.setProperty(rt, name, jsi::String::createFromUtf8(rt, text ? text : ""));
                break;
            }
            case SQLITE_BLOB: {
                // Store blobs as base64 strings? For simplicity, skip for now
                const char *text = reinterpret_cast<const char *>(sqlite3_column_text(stmt, i));
                obj.setProperty(rt, name, jsi::String::createFromUtf8(rt, text ? text : ""));
                break;
            }
        }
    }
    return obj;
}

// ─── Database operations ─────────────────────────────────────────────────────

void Database::execute(const std::string &sql, const jsi::Array &args, jsi::Runtime &rt) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!db_) {
        throw jsi::JSError(rt, "PomegranateDB: database is closed");
    }

    sqlite3_stmt *stmt = cachedPrepare(sql);
    SqliteStatement guard(stmt);
    bindArgs(stmt, args, rt);

    int result = sqlite3_step(stmt);
    if (result != SQLITE_DONE && result != SQLITE_ROW) {
        throw jsi::JSError(rt, "PomegranateDB: execute failed: " + db_->lastErrorMessage());
    }
}

jsi::Array Database::query(const std::string &sql, const jsi::Array &args, jsi::Runtime &rt) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!db_) {
        throw jsi::JSError(rt, "PomegranateDB: database is closed");
    }

    sqlite3_stmt *stmt = cachedPrepare(sql);
    SqliteStatement guard(stmt);
    bindArgs(stmt, args, rt);

    std::vector<jsi::Object> rows;
    while (true) {
        int result = sqlite3_step(stmt);
        if (result == SQLITE_ROW) {
            rows.push_back(rowToObject(stmt, rt));
        } else if (result == SQLITE_DONE) {
            break;
        } else {
            throw jsi::JSError(rt, "PomegranateDB: query failed: " + db_->lastErrorMessage());
        }
    }

    jsi::Array arr(rt, rows.size());
    for (size_t i = 0; i < rows.size(); i++) {
        arr.setValueAtIndex(rt, i, std::move(rows[i]));
    }
    return arr;
}

int Database::executeBatch(const jsi::Array &commands, jsi::Runtime &rt) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!db_) {
        throw jsi::JSError(rt, "PomegranateDB: database is closed");
    }

    int totalChanges = 0;
    size_t count = commands.size(rt);

    db_->execute("BEGIN TRANSACTION");
    try {
        for (size_t i = 0; i < count; i++) {
            jsi::Object cmd = commands.getValueAtIndex(rt, i).getObject(rt);
            std::string sql = cmd.getProperty(rt, "sql").getString(rt).utf8(rt);
            jsi::Array args = cmd.getProperty(rt, "args").getObject(rt).getArray(rt);

            sqlite3_stmt *stmt = cachedPrepare(sql);
            SqliteStatement guard(stmt);
            bindArgs(stmt, args, rt);

            int result = sqlite3_step(stmt);
            if (result != SQLITE_DONE && result != SQLITE_ROW) {
                throw std::runtime_error(db_->lastErrorMessage());
            }
            totalChanges += sqlite3_changes(db_->getHandle());
        }
        db_->execute("COMMIT");
    } catch (...) {
        db_->execute("ROLLBACK");
        throw;
    }

    return totalChanges;
}

// ─── Turbo sync ──────────────────────────────────────────────────────────────

namespace {

/** Convert an optional JS { table: [columns] } object into TableColumns. */
bool readSchema(const jsi::Value &schema, jsi::Runtime &rt, syncjson::TableColumns &out) {
    if (schema.isUndefined() || schema.isNull()) {
        return false;
    }
    if (!schema.isObject()) {
        throw jsi::JSError(rt, "applySyncJson: schema must be an object of { table: [columns] }");
    }
    jsi::Object object = schema.getObject(rt);
    jsi::Array names = object.getPropertyNames(rt);
    size_t count = names.size(rt);
    for (size_t i = 0; i < count; i++) {
        std::string table = names.getValueAtIndex(rt, i).getString(rt).utf8(rt);
        jsi::Value columnsValue = object.getProperty(rt, table.c_str());
        if (!columnsValue.isObject() || !columnsValue.getObject(rt).isArray(rt)) {
            throw jsi::JSError(rt, "applySyncJson: schema." + table + " must be an array of column names");
        }
        jsi::Array columns = columnsValue.getObject(rt).getArray(rt);
        std::unordered_set<std::string> set;
        size_t columnCount = columns.size(rt);
        for (size_t c = 0; c < columnCount; c++) {
            set.insert(columns.getValueAtIndex(rt, c).getString(rt).utf8(rt));
        }
        out.emplace(std::move(table), std::move(set));
    }
    return true;
}

}  // namespace

jsi::Object Database::importSyncJson(std::string &json, const jsi::Value &schema, jsi::Runtime &rt) {
    syncjson::TableColumns tableColumns;
    bool hasSchema = readSchema(schema, rt, tableColumns);

    syncjson::ImportStats stats;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!db_) {
            throw jsi::JSError(rt, "PomegranateDB: database is closed");
        }
        try {
            stats = syncjson::importSyncJson(db_->getHandle(), json, hasSchema ? &tableColumns : nullptr);
        } catch (const std::exception &error) {
            throw jsi::JSError(rt, error.what());
        }
    }

    jsi::Object result(rt);
    result.setProperty(rt, "timestamp", stats.hasTimestamp ? jsi::Value(stats.timestamp) : jsi::Value::null());
    result.setProperty(rt, "tables", jsi::Value(static_cast<double>(stats.tables)));
    result.setProperty(rt, "inserted", jsi::Value(static_cast<double>(stats.inserted)));
    result.setProperty(rt, "deleted", jsi::Value(static_cast<double>(stats.deleted)));
    result.setProperty(rt, "skippedTables", jsi::Value(static_cast<double>(stats.skippedTables)));
    result.setProperty(rt, "skippedColumns", jsi::Value(static_cast<double>(stats.skippedColumns)));
    return result;
}

jsi::Object Database::applySyncJson(int syncJsonId, const jsi::Value &schema, jsi::Runtime &rt) {
    std::string json;
    if (!syncjson::take(syncJsonId, json)) {
        throw jsi::JSError(rt, "PomegranateDB: no sync JSON was provided under id " + std::to_string(syncJsonId));
    }
    return importSyncJson(json, schema, rt);
}

jsi::Object Database::applySyncJsonText(const std::string &jsonText, const jsi::Value &schema, jsi::Runtime &rt) {
    std::string json = jsonText;
    return importSyncJson(json, schema, rt);
}

// ─── JSI Installation ────────────────────────────────────────────────────────

void Database::install(jsi::Runtime &rt) {
    auto createAdapter = jsi::Function::createFromHostFunction(
        rt, jsi::PropNameID::forAscii(rt, "nativePomegranateCreateAdapter"),
        1,  // dbName
        [](jsi::Runtime &rt, const jsi::Value &thisVal, const jsi::Value *args, size_t count) -> jsi::Value {
            if (count < 1 || !args[0].isString()) {
                throw jsi::JSError(rt, "nativePomegranateCreateAdapter: expected database name string");
            }

            std::string dbName = args[0].getString(rt).utf8(rt);
            std::string dbPath = platform::resolveDatabasePath(dbName);

            auto database = std::make_shared<Database>(rt, dbPath);

            jsi::Object adapter(rt);

            // ─── execute(sql, args) ──────────────────────────────
            adapter.setProperty(
                rt, "execute",
                jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "execute"), 2,
                                                      [database](jsi::Runtime &rt, const jsi::Value &,
                                                                 const jsi::Value *args, size_t count) -> jsi::Value {
                                                          if (count < 2) {
                                                              throw jsi::JSError(rt, "execute: expected (sql, args)");
                                                          }
                                                          std::string sql = args[0].getString(rt).utf8(rt);
                                                          jsi::Array bindArgs = args[1].getObject(rt).getArray(rt);
                                                          database->execute(sql, bindArgs, rt);
                                                          return jsi::Value::undefined();
                                                      }));

            // ─── query(sql, args) → Array<Object> ───────────────
            adapter.setProperty(
                rt, "query",
                jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "query"), 2,
                                                      [database](jsi::Runtime &rt, const jsi::Value &,
                                                                 const jsi::Value *args, size_t count) -> jsi::Value {
                                                          if (count < 2) {
                                                              throw jsi::JSError(rt, "query: expected (sql, args)");
                                                          }
                                                          std::string sql = args[0].getString(rt).utf8(rt);
                                                          jsi::Array bindArgs = args[1].getObject(rt).getArray(rt);
                                                          return database->query(sql, bindArgs, rt);
                                                      }));

            // ─── executeBatch(commands) → number ─────────────────
            adapter.setProperty(rt, "executeBatch",
                                jsi::Function::createFromHostFunction(
                                    rt, jsi::PropNameID::forAscii(rt, "executeBatch"), 1,
                                    [database](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args,
                                               size_t count) -> jsi::Value {
                                        if (count < 1) {
                                            throw jsi::JSError(rt, "executeBatch: expected (commands)");
                                        }
                                        jsi::Array commands = args[0].getObject(rt).getArray(rt);
                                        int changes = database->executeBatch(commands, rt);
                                        return jsi::Value(changes);
                                    }));

            // ─── applySyncJson(syncJsonId, schema?) → stats ──────
            adapter.setProperty(
                rt, "applySyncJson",
                jsi::Function::createFromHostFunction(
                    rt, jsi::PropNameID::forAscii(rt, "applySyncJson"), 2,
                    [database](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
                        if (count < 1 || !args[0].isNumber()) {
                            throw jsi::JSError(rt, "applySyncJson: expected (syncJsonId: number, schema?)");
                        }
                        int id = static_cast<int>(args[0].getNumber());
                        jsi::Value none = jsi::Value::undefined();
                        const jsi::Value &schema = count > 1 ? args[1] : none;
                        return database->applySyncJson(id, schema, rt);
                    }));

            // ─── applySyncJsonText(json, schema?) → stats ────────
            adapter.setProperty(
                rt, "applySyncJsonText",
                jsi::Function::createFromHostFunction(
                    rt, jsi::PropNameID::forAscii(rt, "applySyncJsonText"), 2,
                    [database](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
                        if (count < 1 || !args[0].isString()) {
                            throw jsi::JSError(rt, "applySyncJsonText: expected (json: string, schema?)");
                        }
                        std::string json = args[0].getString(rt).utf8(rt);
                        jsi::Value none = jsi::Value::undefined();
                        const jsi::Value &schema = count > 1 ? args[1] : none;
                        return database->applySyncJsonText(json, schema, rt);
                    }));

            // ─── close() ────────────────────────────────────────
            adapter.setProperty(
                rt, "close",
                jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "close"), 0,
                                                      [database](jsi::Runtime &rt, const jsi::Value &,
                                                                 const jsi::Value *args, size_t count) -> jsi::Value {
                                                          database->close();
                                                          return jsi::Value::undefined();
                                                      }));

            return adapter;
        });

    rt.global().setProperty(rt, "nativePomegranateCreateAdapter", std::move(createAdapter));

    // ─── nativePomegranateProvideSyncJson(id, text) ─────────────────────
    // JS-side entry to the turbo store, for tests and for payloads that
    // already exist as a JS string. Native modules should call
    // syncjson::provide() directly so the bytes never reach the runtime.
    rt.global().setProperty(
        rt, "nativePomegranateProvideSyncJson",
        jsi::Function::createFromHostFunction(
            rt, jsi::PropNameID::forAscii(rt, "nativePomegranateProvideSyncJson"), 2,
            [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
                if (count < 2 || !args[0].isNumber() || !args[1].isString()) {
                    throw jsi::JSError(rt, "nativePomegranateProvideSyncJson: expected (id: number, json: string)");
                }
                syncjson::provide(static_cast<int>(args[0].getNumber()), args[1].getString(rt).utf8(rt));
                return jsi::Value::undefined();
            }));

    // ─── nativePomegranateDiscardSyncJson(id) → boolean ─────────────────
    rt.global().setProperty(
        rt, "nativePomegranateDiscardSyncJson",
        jsi::Function::createFromHostFunction(
            rt, jsi::PropNameID::forAscii(rt, "nativePomegranateDiscardSyncJson"), 1,
            [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
                if (count < 1 || !args[0].isNumber()) {
                    throw jsi::JSError(rt, "nativePomegranateDiscardSyncJson: expected (id: number)");
                }
                return jsi::Value(syncjson::discard(static_cast<int>(args[0].getNumber())));
            }));
    platform::consoleLog("PomegranateDB: JSI bridge installed");
}

}  // namespace pomegranate
