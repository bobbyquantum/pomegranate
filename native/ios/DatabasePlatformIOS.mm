/**
 * PomegranateDB — iOS platform implementation.
 *
 * Provides platform::resolveDatabasePath via NSDocumentDirectory,
 * and platform::consoleLog/consoleError via NSLog.
 */

#include "Database.h"
#import <Foundation/Foundation.h>
#include <mutex>
#include <sqlite3.h>

#define LOG_TAG "pomegranate.jsi"

namespace pomegranate {
namespace platform {

// ─── Logging ─────────────────────────────────────────────────────────────────

void consoleLog(const std::string &message) {
    NSLog(@"[%s] %s", LOG_TAG, message.c_str());
}

void consoleError(const std::string &message) {
    NSLog(@"[%s] ERROR: %s", LOG_TAG, message.c_str());
}

// ─── SQLite initialization ───────────────────────────────────────────────────

static void sqliteLogCallback(void *, int err, const char *message) {
    int errType = err & 255;
    if (errType == SQLITE_WARNING) {
        NSLog(@"[%s] sqlite warning (%d): %s", LOG_TAG, err, message);
    } else if (errType == 0 || errType == SQLITE_CONSTRAINT ||
               errType == SQLITE_SCHEMA || errType == SQLITE_NOTICE) {
        // verbose — skip
    } else {
        NSLog(@"[%s] sqlite error (%d): %s", LOG_TAG, err, message);
    }
}

static std::once_flag sqliteInitFlag;

static void initializeSqlite() {
    std::call_once(sqliteInitFlag, []() {
        sqlite3_config(SQLITE_CONFIG_LOG, &sqliteLogCallback, nullptr);
        sqlite3_soft_heap_limit(8 * 1024 * 1024);
        sqlite3_initialize();
    });
}

// ─── Path resolution ─────────────────────────────────────────────────────────

std::string resolveDatabasePath(const std::string &dbName) {
    initializeSqlite();

    NSError *err = nil;
    NSURL *documentsUrl =
        [NSFileManager.defaultManager URLForDirectory:NSDocumentDirectory
                                             inDomain:NSUserDomainMask
                                    appropriateForURL:nil
                                               create:YES
                                                error:&err];
    if (err || !documentsUrl) {
        NSString *desc = err ? err.localizedDescription : @"unknown";
        throw std::runtime_error(
            "PomegranateDB: failed to resolve documents directory — " +
            std::string([desc cStringUsingEncoding:NSUTF8StringEncoding]));
    }

    NSString *filename = [NSString stringWithFormat:@"%s.db", dbName.c_str()];
    NSURL *dbUrl = [documentsUrl URLByAppendingPathComponent:filename];
    const char *cPath = dbUrl.path.UTF8String;

    if (!cPath) {
        throw std::runtime_error("PomegranateDB: failed to construct db path for " + dbName);
    }

    return std::string(cPath);
}

}  // namespace platform
}  // namespace pomegranate
