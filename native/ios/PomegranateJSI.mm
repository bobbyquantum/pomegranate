/**
 * PomegranateDB — iOS JSI Bridge implementation.
 *
 * Conforms to RCTBridgeModule and provides a synchronous install() method
 * that registers nativePomegranateCreateAdapter into the JS runtime via JSI.
 *
 * Usage (JS side, early in app lifecycle):
 *   import { NativeModules } from 'react-native';
 *   NativeModules.PomegranateJSIBridge.install();
 */

#import "PomegranateJSI.h"
#import <React/RCTBridge+Private.h>
#import <React/RCTLog.h>
#import <jsi/jsi.h>

// Our C++ database bridge
#import "Database.h"

@implementation PomegranateJSI

@synthesize bridge = _bridge;

// ─── RCTBridgeModule boilerplate ──────────────────────────────────────────────

RCT_EXPORT_MODULE(PomegranateJSIBridge)

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

// ─── install() ────────────────────────────────────────────────────────────────

/**
 * Synchronously installs the JSI global into the current JS runtime.
 * Must be called before using NativeSQLiteAdapter.
 * Returns @YES on success, @NO if the bridge doesn't expose a runtime.
 */
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) {
    @try {
        RCTCxxBridge *cxxBridge = (RCTCxxBridge *)_bridge;
        if (!cxxBridge || !cxxBridge.runtime) {
            RCTLogError(@"[PomegranateDB] Bridge or runtime is nil — cannot install JSI binding. "
                        @"Are you using the JSC / Hermes runtime?");
            return @(NO);
        }

        auto *runtime = (facebook::jsi::Runtime *)cxxBridge.runtime;
        pomegranate::Database::install(*runtime);

        RCTLogInfo(@"[PomegranateDB] Successfully installed JSI bindings!");
        return @(YES);
    } @catch (NSException *exception) {
        RCTLogError(@"[PomegranateDB] Failed to install JSI bindings: %@", exception.reason);
        return @(NO);
    }
}

@end
