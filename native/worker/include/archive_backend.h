#pragma once

#include <cstdint>
#include <string>
#include <vector>

/**
 * Abstract interface for archive backends.
 *
 * Two-phase approach:
 * 1. open() — lists entries and extracts all to a raw/ directory (single sequential scan)
 * 2. getEntry(index) — reads a specific entry from disk (random access, instant)
 *
 * This avoids re-scanning the archive for each page request.
 */
class ArchiveBackend {
public:
    virtual ~ArchiveBackend() = default;

    /// Open the archive, list entries, extract all to rawDir.
    /// Returns total image entry count.
    /// progressCb is called after each entry: (currentIndex, totalEstimate, entryName)
    using ProgressCb = void(*)(int current, int total, const std::string& name, void* userData);
    virtual int open(const std::string& archivePath, const std::string& rawDir,
                     ProgressCb progressCb = nullptr, void* userData = nullptr) = 0;

    /// Best-effort preview extraction for the sorted page index requested by the UI.
    /// Implementations may perform a lightweight prepass and emit a single raw file.
    virtual bool extractPreview(const std::string& archivePath, const std::string& rawDir,
                                int sortedIndex, std::string& outEntryName,
                                std::string& outRawRelativePath) = 0;

    /// Get the number of image entries
    virtual int entryCount() const = 0;

    /// Get entry name by sorted index
    virtual std::string entryName(int index) const = 0;

    /// Read an entry's bytes from the raw directory (random access).
    virtual bool getEntry(int index, std::vector<uint8_t>& outData) const = 0;

    /// Close and free resources (does NOT delete raw files — caller manages temp)
    virtual void close() = 0;
};
