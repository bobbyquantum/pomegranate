/**
 * PomegranateDB — Turbo sync JSON importer implementation.
 */

#include "SyncJsonImporter.h"

#include <stdexcept>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "SyncJsonStore.h"
#include "simdjson/simdjson.h"

namespace pomegranate {
namespace syncjson {

static_assert(kPadding >= simdjson::SIMDJSON_PADDING, "SyncJsonStore::kPadding must cover SIMDJSON_PADDING");

namespace {

using namespace simdjson;

// ─── Helpers ─────────────────────────────────────────────────────────────────

[[noreturn]] void fail(const std::string &message) {
    throw std::runtime_error("PomegranateDB turbo sync: " + message);
}

[[noreturn]] void failSqlite(sqlite3 *db, const std::string &what) {
    fail(what + ": " + sqlite3_errmsg(db));
}

void exec(sqlite3 *db, const char *sql) {
    char *err = nullptr;
    if (sqlite3_exec(db, sql, nullptr, nullptr, &err) != SQLITE_OK) {
        std::string message = err ? err : "unknown error";
        sqlite3_free(err);
        fail(std::string(sql) + " failed: " + message);
    }
}

/** Same rule as sanitizeTableName / sanitizeColumnName in the TS layer. */
bool isSafeIdentifier(std::string_view s) {
    if (s.empty()) return false;
    auto alpha = [](char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'; };
    auto alnum = [&](char c) { return alpha(c) || (c >= '0' && c <= '9'); };
    if (!alpha(s[0])) return false;
    for (char c : s.substr(1)) {
        if (!alnum(c)) return false;
    }
    return true;
}

// ─── Cells ───────────────────────────────────────────────────────────────────

enum class Kind { Null, Bool, Int, UInt, Double, Text, RawJson };

/**
 * One column of one record. `key` and `text` are views into simdjson's string
 * buffer (or the source document for RawJson), both stable for the lifetime of
 * the document iteration.
 */
struct Cell {
    std::string_view key;
    Kind kind = Kind::Null;
    std::string_view text;
    std::int64_t i = 0;
    std::uint64_t u = 0;
    double d = 0;
    bool b = false;
};

Cell readCell(std::string_view key, ondemand::value value) {
    Cell cell;
    cell.key = key;
    switch (value.type()) {
        case ondemand::json_type::null:
            cell.kind = Kind::Null;
            break;
        case ondemand::json_type::boolean:
            cell.kind = Kind::Bool;
            cell.b = value.get_bool();
            break;
        case ondemand::json_type::number: {
            ondemand::number number = value.get_number();
            switch (number.get_number_type()) {
                case ondemand::number_type::signed_integer:
                    cell.kind = Kind::Int;
                    cell.i = number.get_int64();
                    break;
                case ondemand::number_type::unsigned_integer:
                    cell.kind = Kind::UInt;
                    cell.u = number.get_uint64();
                    break;
                default:
                    cell.kind = Kind::Double;
                    cell.d = number.get_double();
                    break;
            }
            break;
        }
        case ondemand::json_type::string:
            cell.kind = Kind::Text;
            cell.text = value.get_string();
            break;
        case ondemand::json_type::array:
        case ondemand::json_type::object:
            // JSON-typed columns arrive as nested values; store them verbatim.
            cell.kind = Kind::RawJson;
            cell.text = value.raw_json();
            break;
        default:
            fail("unsupported JSON value for column \"" + std::string(key) + "\"");
    }
    return cell;
}

void bindCell(sqlite3_stmt *stmt, int index, const Cell &cell) {
    switch (cell.kind) {
        case Kind::Null:
            sqlite3_bind_null(stmt, index);
            break;
        case Kind::Bool:
            sqlite3_bind_int(stmt, index, cell.b ? 1 : 0);
            break;
        case Kind::Int:
            sqlite3_bind_int64(stmt, index, cell.i);
            break;
        case Kind::UInt:
            if (cell.u <= static_cast<std::uint64_t>(INT64_MAX)) {
                sqlite3_bind_int64(stmt, index, static_cast<std::int64_t>(cell.u));
            } else {
                sqlite3_bind_double(stmt, index, static_cast<double>(cell.u));
            }
            break;
        case Kind::Double:
            sqlite3_bind_double(stmt, index, cell.d);
            break;
        case Kind::Text:
        case Kind::RawJson:
            // The text lives in simdjson's buffers, which outlive the step() below,
            // so SQLite may reference it directly instead of copying.
            sqlite3_bind_text(stmt, index, cell.text.data(), static_cast<int>(cell.text.size()), SQLITE_STATIC);
            break;
    }
}

// ─── Statement cache ─────────────────────────────────────────────────────────

class StatementCache {
   public:
    explicit StatementCache(sqlite3 *db) : db_(db) {}
    ~StatementCache() {
        for (auto &entry : statements_) {
            sqlite3_finalize(entry.second);
        }
    }
    StatementCache(const StatementCache &) = delete;
    StatementCache &operator=(const StatementCache &) = delete;

    sqlite3_stmt *get(const std::string &sql) {
        auto it = statements_.find(sql);
        if (it != statements_.end()) return it->second;
        sqlite3_stmt *stmt = nullptr;
        if (sqlite3_prepare_v2(db_, sql.c_str(), static_cast<int>(sql.size()), &stmt, nullptr) != SQLITE_OK) {
            failSqlite(db_, "prepare failed for " + sql);
        }
        statements_.emplace(sql, stmt);
        return stmt;
    }

   private:
    sqlite3 *db_;
    std::unordered_map<std::string, sqlite3_stmt *> statements_;
};

// ─── Import ──────────────────────────────────────────────────────────────────

struct Context {
    sqlite3 *db;
    StatementCache cache;
    ImportStats stats;
    std::vector<Cell> cells;
    std::string sql;
    explicit Context(sqlite3 *database) : db(database), cache(database) {}
};

void importRecord(Context &ctx, const std::string &table, const std::unordered_set<std::string_view> *allowed,
                  ondemand::object record) {
    ctx.cells.clear();
    bool hasId = false;

    for (auto field : record) {
        std::string_view key = field.unescaped_key();
        if (key == "_status" || key == "_changed") {
            continue;  // always rewritten below; the unconsumed value is skipped by simdjson
        }
        if (key == "id") {
            hasId = true;
        } else if (allowed && allowed->count(key) == 0) {
            ctx.stats.skippedColumns++;
            continue;
        }
        if (!isSafeIdentifier(key)) {
            fail("unsafe column name \"" + std::string(key) + "\" in table " + table);
        }
        ctx.cells.push_back(readCell(key, field.value()));
    }

    if (!hasId) {
        fail("record without id in table " + table);
    }

    // INSERT OR REPLACE INTO "t" ("a", "b", "_status", "_changed") VALUES (?, ?, 'synced', '')
    std::string &sql = ctx.sql;
    sql.clear();
    sql += "INSERT OR REPLACE INTO \"";
    sql += table;
    sql += "\" (";
    for (const Cell &cell : ctx.cells) {
        sql += '"';
        sql += cell.key;
        sql += "\", ";
    }
    sql += "\"_status\", \"_changed\") VALUES (";
    for (std::size_t i = 0; i < ctx.cells.size(); i++) {
        sql += "?, ";
    }
    sql += "'synced', '')";

    sqlite3_stmt *stmt = ctx.cache.get(sql);
    for (std::size_t i = 0; i < ctx.cells.size(); i++) {
        bindCell(stmt, static_cast<int>(i) + 1, ctx.cells[i]);
    }
    int rc = sqlite3_step(stmt);
    sqlite3_reset(stmt);
    sqlite3_clear_bindings(stmt);
    if (rc != SQLITE_DONE) {
        failSqlite(ctx.db, "insert into " + table + " failed");
    }
    ctx.stats.inserted++;
}

void importDeleted(Context &ctx, const std::string &table, ondemand::array ids) {
    sqlite3_stmt *stmt = ctx.cache.get("DELETE FROM \"" + table + "\" WHERE \"id\" = ?");
    for (auto idValue : ids) {
        std::string_view id = idValue.get_string();
        sqlite3_bind_text(stmt, 1, id.data(), static_cast<int>(id.size()), SQLITE_STATIC);
        int rc = sqlite3_step(stmt);
        sqlite3_reset(stmt);
        sqlite3_clear_bindings(stmt);
        if (rc != SQLITE_DONE) {
            failSqlite(ctx.db, "delete from " + table + " failed");
        }
        ctx.stats.deleted++;
    }
}

void importTable(Context &ctx, const std::string &table, const std::unordered_set<std::string_view> *allowed,
                 ondemand::object changes) {
    ctx.stats.tables++;
    for (auto section : changes) {
        std::string_view name = section.unescaped_key();
        if (name == "created" || name == "updated") {
            for (auto record : section.value().get_array()) {
                importRecord(ctx, table, allowed, record.get_object());
            }
        } else if (name == "deleted") {
            importDeleted(ctx, table, section.value().get_array());
        }
        // Unknown sections are skipped by simdjson when their value is not consumed.
    }
}

}  // namespace

ImportStats importSyncJson(sqlite3 *db, std::string &json, const TableColumns *schema) {
    if (json.capacity() < json.size() + kPadding) {
        json.reserve(json.size() + kPadding);
    }

    // Schema lookup keyed by views into the caller's strings (valid for the call).
    std::unordered_map<std::string_view, std::unordered_set<std::string_view>> allowed;
    if (schema) {
        allowed.reserve(schema->size());
        for (const auto &entry : *schema) {
            std::unordered_set<std::string_view> columns;
            columns.reserve(entry.second.size());
            for (const std::string &column : entry.second) {
                columns.insert(column);
            }
            allowed.emplace(entry.first, std::move(columns));
        }
    }

    Context ctx(db);
    exec(db, "BEGIN");
    try {
        ondemand::parser parser;
        padded_string_view view = pad(json);
        ondemand::document doc = parser.iterate(view);

        for (auto top : doc.get_object()) {
            std::string_view key = top.unescaped_key();
            if (key == "timestamp") {
                ctx.stats.timestamp = top.value().get_double();
                ctx.stats.hasTimestamp = true;
            } else if (key == "changes") {
                for (auto tableField : top.value().get_object()) {
                    std::string table(std::string_view(tableField.unescaped_key().value()));
                    if (!isSafeIdentifier(table)) {
                        fail("unsafe table name \"" + table + "\"");
                    }
                    const std::unordered_set<std::string_view> *columns = nullptr;
                    if (schema) {
                        auto it = allowed.find(std::string_view(table));
                        if (it == allowed.end()) {
                            ctx.stats.skippedTables++;
                            continue;
                        }
                        columns = &it->second;
                    }
                    importTable(ctx, table, columns, tableField.value().get_object());
                }
            }
        }
        exec(db, "COMMIT");
    } catch (const simdjson_error &error) {
        sqlite3_exec(db, "ROLLBACK", nullptr, nullptr, nullptr);
        fail(std::string("invalid sync JSON: ") + error.what());
    } catch (...) {
        sqlite3_exec(db, "ROLLBACK", nullptr, nullptr, nullptr);
        throw;
    }
    return ctx.stats;
}

}  // namespace syncjson
}  // namespace pomegranate
