/**
 * PomegranateDB — Turbo sync JSON store implementation.
 */

#include "SyncJsonStore.h"

#include <mutex>
#include <unordered_map>

namespace pomegranate {
namespace syncjson {

namespace {
std::mutex &storeMutex() {
    static std::mutex m;
    return m;
}

std::unordered_map<int, std::string> &store() {
    static std::unordered_map<int, std::string> s;
    return s;
}
}  // namespace

void provide(int id, std::string json) {
    // Reserve the padding now so the importer can parse in place without a copy.
    json.reserve(json.size() + kPadding);
    std::lock_guard<std::mutex> lock(storeMutex());
    store()[id] = std::move(json);
}

bool take(int id, std::string &out) {
    std::lock_guard<std::mutex> lock(storeMutex());
    auto it = store().find(id);
    if (it == store().end()) {
        return false;
    }
    out = std::move(it->second);
    store().erase(it);
    return true;
}

bool discard(int id) {
    std::lock_guard<std::mutex> lock(storeMutex());
    return store().erase(id) > 0;
}

std::size_t pendingCount() {
    std::lock_guard<std::mutex> lock(storeMutex());
    return store().size();
}

}  // namespace syncjson
}  // namespace pomegranate
