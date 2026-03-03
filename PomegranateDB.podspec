require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "PomegranateDB"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.description  = package["description"]
  s.homepage     = "https://github.com/#{package.dig("repository", "url") || "bobbyquantum/pomegranate"}"
  s.license      = { :type => "MIT", :file => "LICENSE" }
  s.author       = { "bobbyquantum" => "" }
  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/bobbyquantum/pomegranate.git",
                     :tag => "v#{s.version}" }

  # ─── Source files ────────────────────────────────────────────────────────────
  #
  # iOS platform glue (Obj-C++ bridge + platform implementation)
  # + shared C++ JSI core (Database.cpp/h, Sqlite.cpp/h)
  #
  # NOTE: We intentionally exclude native/shared/sqlite3/ here; iOS links the
  # system SQLite via s.libraries below, so we must not compile the amalgamation
  # twice.
  s.source_files = [
    "native/ios/**/*.{h,m,mm}",
    "native/shared/*.{h,cpp}",
  ]

  s.public_header_files = [
    "native/ios/PomegranateJSI.h",
  ]

  # ─── Compiler settings ───────────────────────────────────────────────────────

  s.requires_arc = true

  # Optimise for size/speed even in debug — JSI is noticeably slower without it.
  s.compiler_flags = "-Os"

  s.pod_target_xcconfig = {
    # C++17 features (structured bindings, string_view, …)
    "CLANG_CXX_LANGUAGE_STANDARD"         => "c++17",
    "CLANG_CXX_LIBRARY"                   => "libc++",
    # Find jsi/jsi.h from React Native's ReactCommon
    "HEADER_SEARCH_PATHS"                 => [
      '"$(PODS_ROOT)/Headers/Public/React-Core"',
      '"$(PODS_ROOT)/Headers/Public"',
      '"$(PODS_TARGET_SRCROOT)/native/shared"',
      '"$(PODS_TARGET_SRCROOT)/native/ios"',
    ].join(" "),
    # Silence noise from mixing C and C++ TUs
    "GCC_WARN_INHIBIT_ALL_WARNINGS"       => "NO",
  }

  # ─── System libraries ────────────────────────────────────────────────────────

  # Link the iOS/macOS system SQLite (sqlite3.h is in the SDK, no amalgamation needed)
  s.libraries = "sqlite3"

  # ─── Dependencies ────────────────────────────────────────────────────────────

  # React-Core brings in React-jsi transitively (as of RN 0.71+).
  # Specifying React-jsi directly fails pod spec lint because it isn't in the
  # public trunk — it resolves from the consuming app's node_modules at install time.
  s.dependency "React-Core"
end
