#pragma once

#include <charconv>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <stdexcept>
#include <string>

inline uint64_t aceUnsigned(const std::string& text) {
    uint64_t value = 0;
    const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (text.empty() || result.ec != std::errc{} || result.ptr != text.data() + text.size()) {
        throw std::runtime_error("Valor numerico ACE no valido");
    }
    return value;
}

inline uint64_t aceConfiguredLimit(const char* name, uint64_t fallback) {
    const char* configured = std::getenv(name);
    if (!configured) return fallback;
    const auto value = aceUnsigned(configured);
    if (!value) throw std::runtime_error(std::string("Limite ACE debe ser positivo: ") + name);
    return value;
}

struct AceLimits {
    uint64_t entries = aceConfiguredLimit("COMISCOPIO_ACE_MAX_ENTRIES", 10000);
    uint64_t entryBytes = aceConfiguredLimit("COMISCOPIO_ACE_MAX_ENTRY_BYTES", 512ULL * 1024 * 1024);
    uint64_t totalBytes = aceConfiguredLimit("COMISCOPIO_ACE_MAX_TOTAL_BYTES", 8ULL * 1024 * 1024 * 1024);

    AceLimits() {
        if (entries > static_cast<uint64_t>(std::numeric_limits<int>::max())) {
            throw std::runtime_error("Limite de entradas ACE fuera de rango");
        }
    }

    void add(uint64_t bytes, uint64_t& count, uint64_t& total) const {
        if (count >= entries) throw std::runtime_error("ACE supera el limite de entradas (" + std::to_string(entries) + ")");
        if (bytes > entryBytes) throw std::runtime_error("ACE supera el limite por archivo (" + std::to_string(entryBytes) + " bytes)");
        if (total > totalBytes || bytes > totalBytes - total) throw std::runtime_error("ACE supera el limite total (" + std::to_string(totalBytes) + " bytes)");
        ++count;
        total += bytes;
    }
};
