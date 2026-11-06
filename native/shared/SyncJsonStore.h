/**
 * PomegranateDB — Turbo sync JSON store.
 *
 * Native code (a download module, a file reader, …) can hand a raw sync
 * payload to this store under an integer id. A later JS call to
 * `adapter.applySyncJson(id)` takes the bytes out of the store and imports
 * them straight into SQLite, so the payload never crosses into the JS
 * runtime. This mirrors WatermelonDB's `provideSyncJson` fast path.
 *
 * The store is process-global and thread-safe. Entries are removed when
 * taken; an id that is never applied stays in memory until `discard`.
 */

#pragma once

#include <cstddef>
#include <string>

namespace pomegranate {
namespace syncjson {

/**
 * Extra bytes the importer requires past the end of the payload.
 * Must be >= SIMDJSON_PADDING (checked with a static_assert in the importer).
 */
constexpr std::size_t kPadding = 64;

/** Store a payload under `id`, replacing any existing entry. Takes ownership. */
void provide(int id, std::string json);

/** Move the payload for `id` into `out`. Returns false when no entry exists. */
bool take(int id, std::string &out);

/** Drop the payload for `id` without importing it. Returns false when absent. */
bool discard(int id);

/** Number of payloads currently held. */
std::size_t pendingCount();

}  // namespace syncjson
}  // namespace pomegranate
