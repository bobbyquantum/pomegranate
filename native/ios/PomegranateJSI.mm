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
#import <React/RCTBridge.h>
#import <objc/message.h>
#import <objc/runtime.h>
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
        // Both the legacy RCTCxxBridge and the bridgeless RCTBridgeProxy answer
        // `-runtime` with the jsi::Runtime*, but neither declares it in a public
        // header any more (React Native 0.88 dropped RCTCxxBridge), so resolve it
        // dynamically instead of casting to a concrete bridge class.
        // The bridgeless bridge is an NSProxy: `respondsToSelector:` on it goes
        // through message forwarding, so ask the runtime about the proxy's own
        // class instead.
        SEL runtimeSelector = NSSelectorFromString(@"runtime");
        if (!_bridge || !class_respondsToSelector(object_getClass(_bridge), runtimeSelector)) {
            RCTLogError(@"[PomegranateDB] Bridge does not expose a JS runtime — cannot install JSI binding. "
                        @"Are you using the JSC / Hermes runtime?");
            return @(NO);
        }

        auto *runtime = ((void *(*)(id, SEL))objc_msgSend)(_bridge, runtimeSelector);
        if (!runtime) {
            RCTLogError(@"[PomegranateDB] JS runtime is nil — cannot install JSI binding yet.");
            return @(NO);
        }

        pomegranate::Database::install(*static_cast<facebook::jsi::Runtime *>(runtime));

        RCTLogInfo(@"[PomegranateDB] Successfully installed JSI bindings!");
        return @(YES);
    } @catch (NSException *exception) {
        RCTLogError(@"[PomegranateDB] Failed to install JSI bindings: %@", exception.reason);
        return @(NO);
    }
}

@end
