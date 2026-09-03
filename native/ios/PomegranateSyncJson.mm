/**
 * PomegranateDB — iOS turbo sync entry point implementation.
 */

#import "PomegranateSyncJson.h"

#include <string>

#include "SyncJsonStore.h"

static NSString *const kPomegranateSyncJsonErrorDomain = @"PomegranateDB.SyncJson";

BOOL pomegranateProvideSyncJson(int32_t syncJsonId, NSData *json, NSError **error) {
    @try {
        if (json == nil) {
            if (error) {
                *error = [NSError errorWithDomain:kPomegranateSyncJsonErrorDomain
                                             code:1
                                         userInfo:@{NSLocalizedDescriptionKey : @"json must not be nil"}];
            }
            return NO;
        }
        std::string bytes(static_cast<const char *>(json.bytes), json.length);
        pomegranate::syncjson::provide(syncJsonId, std::move(bytes));
        return YES;
    } @catch (NSException *exception) {
        if (error) {
            *error = [NSError errorWithDomain:kPomegranateSyncJsonErrorDomain
                                         code:2
                                     userInfo:@{NSLocalizedDescriptionKey : exception.reason ?: @"unknown error"}];
        }
        return NO;
    }
}

BOOL pomegranateDiscardSyncJson(int32_t syncJsonId) {
    return pomegranate::syncjson::discard(syncJsonId) ? YES : NO;
}
