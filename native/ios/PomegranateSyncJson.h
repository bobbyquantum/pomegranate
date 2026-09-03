/**
 * PomegranateDB — iOS turbo sync entry point.
 *
 * Native code that already holds a sync payload as bytes (for example a
 * module that downloaded and decompressed a bundle) hands it to PomegranateDB
 * with `pomegranateProvideSyncJson`. JS then calls
 * `adapter.applySyncJson(syncJsonId)` and the rows are written straight into
 * SQLite without the payload ever crossing into the JS runtime.
 *
 * Import this header from Swift via the app's bridging header, or declare the
 * symbol directly:
 *
 *   extern void pomegranateProvideSyncJson(int32_t syncJsonId, NSData * _Nonnull json,
 *                                          NSError * _Nullable * _Nullable error);
 */

#pragma once

#import <Foundation/Foundation.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Store `json` under `syncJsonId`. Returns YES on success. On failure returns
 * NO and, when `error` is non-NULL, fills it with a description.
 */
BOOL pomegranateProvideSyncJson(int32_t syncJsonId, NSData * _Nonnull json, NSError * _Nullable * _Nullable error);

/** Drop a payload that will not be applied. Returns YES if one was stored. */
BOOL pomegranateDiscardSyncJson(int32_t syncJsonId);

#ifdef __cplusplus
}
#endif
