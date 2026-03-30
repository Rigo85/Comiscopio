#pragma once

#include "archive_backend.h"
#include "archive_entry_utils.h"

#include <archive.h>
#include <archive_entry.h>

#include <string>

/**
 * Base class for archive backends that use libarchive.
 *
 * Subclasses only need to override configureFormat() to specify
 * which archive format(s) to enable (zip, 7zip, tar, etc.).
 * All extraction, sorting, preview, and entry access logic is shared.
 */
class LibarchiveBackend : public ArchiveBackend {
public:
    int open(const std::string& archivePath, const std::string& rawDir,
             ProgressCb progressCb, void* userData) override;

    bool extractPreview(const std::string& archivePath, const std::string& rawDir,
                        int sortedIndex, std::string& outEntryName,
                        std::string& outRawRelativePath) override;

    int entryCount() const override;
    std::string entryName(int index) const override;
    bool getEntry(int index, std::vector<uint8_t>& outData) const override;
    void close() override;

protected:
    /// Subclasses configure which format(s) libarchive should support.
    virtual void configureFormat(archive* arc) const = 0;

    /// Human-readable format name for error messages (e.g. "ZIP", "7z", "TAR").
    virtual const char* formatLabel() const = 0;

private:
    archive* openArchive(const std::string& archivePath) const;
    std::string rawDir;
    std::vector<CanonicalArchiveEntry> entries;
};
