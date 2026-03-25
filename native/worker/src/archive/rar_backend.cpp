#include "archive_backend.h"
#include "unrar_compat.h"
#include <algorithm>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <set>

namespace fs = std::filesystem;

static const std::set<std::string> IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".bmp", ".tiff", ".tif"
};

static std::string toLower(const std::string& s) {
    std::string result = s;
    std::transform(result.begin(), result.end(), result.begin(), ::tolower);
    return result;
}

static std::string getExtension(const std::string& filename) {
    auto pos = filename.rfind('.');
    if (pos == std::string::npos) return "";
    return toLower(filename.substr(pos));
}

static bool isImageFile(const std::string& filename) {
    return IMAGE_EXTENSIONS.count(getExtension(filename)) > 0;
}

struct RarIndexEntry {
    std::string archiveName;  // name inside the archive
    std::string rawPath;      // path on disk after extraction
    int sortedIndex;
};

/**
 * RAR backend using the UnRAR DLL API.
 *
 * Single sequential scan: lists all entries, extracts images to raw/ directory,
 * sorts by name. After that, any page is accessible instantly from disk.
 */
class RarBackend : public ArchiveBackend {
public:
    int open(const std::string& archivePath, const std::string& rawDir,
             ProgressCb progressCb, void* userData) override {

        this->rawDir = rawDir;
        entries.clear();

        fs::create_directories(rawDir);

        // Single pass: list + extract all image entries
        RAROpenArchiveDataEx arcData{};
        arcData.ArcName = const_cast<char*>(archivePath.c_str());
        arcData.OpenMode = RAR_OM_EXTRACT;

        HANDLE hArc = RAROpenArchiveEx(&arcData);
        if (!hArc || arcData.OpenResult != 0) {
            throw std::runtime_error("Failed to open RAR archive: " + archivePath);
        }

        // Collect all image entries with their data
        struct RawEntry {
            std::string name;
            std::vector<uint8_t> data;
        };
        std::vector<RawEntry> rawEntries;

        extractBuffer.clear();
        RARSetCallback(hArc, extractCallback, reinterpret_cast<LPARAM>(this));

        RARHeaderDataEx header{};
        int scanned = 0;

        while (RARReadHeaderEx(hArc, &header) == 0) {
            std::string name(header.FileName);
            bool isDir = (header.Flags & RHDF_DIRECTORY) != 0;
            bool isImage = !isDir && isImageFile(name);

            if (isImage) {
                extractBuffer.clear();
                int result = RARProcessFile(hArc, RAR_TEST, nullptr, nullptr);
                if (result == 0) {
                    rawEntries.push_back({name, std::move(extractBuffer)});
                    extractBuffer = {}; // reset after move
                } else {
                    // Extraction failed for this entry — store empty
                    rawEntries.push_back({name, {}});
                }
                scanned++;
            } else {
                RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
            }
        }

        RARCloseArchive(hArc);

        // Sort naturally by name
        std::vector<size_t> sortOrder(rawEntries.size());
        for (size_t i = 0; i < sortOrder.size(); i++) sortOrder[i] = i;
        std::sort(sortOrder.begin(), sortOrder.end(), [&](size_t a, size_t b) {
            return rawEntries[a].name < rawEntries[b].name;
        });

        // Write to disk in sorted order and build index
        int totalImages = static_cast<int>(sortOrder.size());
        for (int i = 0; i < totalImages; i++) {
            const auto& raw = rawEntries[sortOrder[i]];
            std::string ext = getExtension(raw.name);
            if (ext.empty()) ext = ".bin";

            char idxBuf[16];
            snprintf(idxBuf, sizeof(idxBuf), "%06d", i);
            std::string rawFileName = std::string(idxBuf) + ext;
            std::string rawPath = rawDir + "/" + rawFileName;

            if (!raw.data.empty()) {
                std::ofstream out(rawPath, std::ios::binary);
                out.write(reinterpret_cast<const char*>(raw.data.data()), raw.data.size());
            }

            RarIndexEntry entry;
            entry.archiveName = raw.name;
            entry.rawPath = rawPath;
            entry.sortedIndex = i;
            entries.push_back(entry);

            if (progressCb) {
                progressCb(i, totalImages, raw.name, userData);
            }
        }

        return totalImages;
    }

    int entryCount() const override {
        return static_cast<int>(entries.size());
    }

    std::string entryName(int index) const override {
        if (index < 0 || index >= static_cast<int>(entries.size())) return "";
        return entries[index].archiveName;
    }

    bool getEntry(int index, std::vector<uint8_t>& outData) const override {
        if (index < 0 || index >= static_cast<int>(entries.size())) return false;

        const auto& entry = entries[index];
        if (!fs::exists(entry.rawPath)) return false;

        auto fileSize = fs::file_size(entry.rawPath);
        outData.resize(fileSize);
        std::ifstream in(entry.rawPath, std::ios::binary);
        if (!in) return false;
        in.read(reinterpret_cast<char*>(outData.data()), fileSize);
        return true;
    }

    void close() override {
        entries.clear();
        extractBuffer.clear();
    }

private:
    std::string rawDir;
    std::vector<RarIndexEntry> entries;
    std::vector<uint8_t> extractBuffer;

    static int CALLBACK extractCallback(UINT msg, LPARAM userData, LPARAM p1, LPARAM p2) {
        if (msg == UCM_PROCESSDATA) {
            auto* self = reinterpret_cast<RarBackend*>(userData);
            auto* data = reinterpret_cast<const uint8_t*>(p1);
            size_t size = static_cast<size_t>(p2);
            self->extractBuffer.insert(self->extractBuffer.end(), data, data + size);
            return 1;
        }
        return 0;
    }
};

std::unique_ptr<ArchiveBackend> createRarBackend() {
    return std::make_unique<RarBackend>();
}
