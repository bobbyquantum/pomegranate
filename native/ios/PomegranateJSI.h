/**
 * PomegranateDB — iOS JSI Bridge.
 *
 * React Native bridge module that installs the PomegranateDB JSI binding.
 * JS calls PomegranateJSI.install() early in the app lifecycle (before
 * using any NativeSQLiteAdapter) to register the global
 * nativePomegranateCreateAdapter function into the JS runtime.
 */

#pragma once

#import <React/RCTBridgeModule.h>

@interface PomegranateJSI : NSObject <RCTBridgeModule>
@end
