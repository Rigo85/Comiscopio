#include "archive_backend.h"

#include <archive.h>
#include <archive_entry.h>

#include <algorithm>
#include <csignal>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;

static const std::set<std::string> IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".bmp", ".tiff", ".tif"
};

static std::string toLowerZip(const std::string& s) {
    std::string result = s;
    std::transform(result.begin(), result.end(), result.begin(), ::tolower);
    return result;
}

static std::string getExtensionZip(const std::string& filename) {
    auto pos = filename.rfind('.');
    if (pos == std::string::npos) return "";
    return toLowerZip(filename.substr(pos));
}

static bool isImageFileZip(const std::string& filename) {
    return IMAGE_EXTENSIONS.count(getExtensionZip(filename)) > 0;
}

static bool isCancelledZip(void* userData) {
    auto* cancelContext = reinterpret_cast<ArchiveCancelContext*>(userData);
    return cancelContext && cancelContext->flag && *cancelContext->flag != 0;
}

struct ZipIndexEntry {
    std::string archiveName;
    std::string rawPath;
};

class ZipBackend : public ArchiveBackend {
public:
    int open(const std::string& archivePath, const std::string& rawDir,
             ProgressCb progressCb, void* userData) override {
        this->rawDir = rawDir;
        entries.clear();
        fs::create_directories(rawDir);

        archive* arc = archive_read_new();
        if (!arc) {
            throw std::runtime_error("Failed to allocate libarchive reader");
        }

        archive_read_support_filter_all(arc);
        archive_read_support_format_zip(arc);

        if (archive_read_open_filename(arc, archivePath.c_str(), 10240) != ARCHIVE_OK) {
            std::string message = archive_error_string(arc) ? archive_error_string(arc) : "unknown error";
            archive_read_free(arc);
            throw std::runtime_error("Failed to open ZIP archive: " + message);
        }

        archive_entry* entry = nullptr;
        int imageCount = 0;

        while (archive_read_next_header(arc, &entry) == ARCHIVE_OK) {
            if (isCancelledZip(userData)) {
                break;
            }

            const char* pathname = archive_entry_pathname(entry);
            std::string name = pathname ? pathname : "";
            const bool isDir = archive_entry_filetype(entry) == AE_IFDIR;
            const bool isImage = !isDir && isImageFileZip(name);

            if (!isImage) {
                archive_read_data_skip(arc);
                continue;
            }

            std::string ext = getExtensionZip(name);
            if (ext.empty()) ext = ".bin";

            char tmpName[32];
            snprintf(tmpName, sizeof(tmpName), "raw_%06d%s", imageCount, ext.c_str());
            std::string rawPath = rawDir + "/" + tmpName;

            // Stream directly to disk (no intermediate buffer)
            std::ofstream out(rawPath, std::ios::binary | std::ios::trunc);
            char chunk[64 * 1024];
            la_ssize_t bytesRead = 0;
            bool failed = false;
            bool cancelled = false;

            if (!out) {
                failed = true;
            } else {
                while ((bytesRead = archive_read_data(arc, chunk, sizeof(chunk))) > 0) {
                    if (isCancelledZip(userData)) {
                        cancelled = true;
                        break;
                    }
                    out.write(chunk, static_cast<std::streamsize>(bytesRead));
                    if (!out.good()) {
                        failed = true;
                        break;
                    }
                }
                if (bytesRead < 0) {
                    failed = true;
                }
                out.close();
            }

            if (cancelled) {
                std::error_code ec;
                fs::remove(rawPath, ec);
                break;
            }

            if (!failed) {
                entries.push_back({name, rawPath});
            } else {
                std::error_code ec;
                fs::remove(rawPath, ec);
                entries.push_back({name, ""});
            }

            if (progressCb) {
                progressCb(imageCount, -1, name, userData);
            }
            imageCount++;
        }

        archive_read_close(arc);
        archive_read_free(arc);

        std::vector<size_t> sortOrder(entries.size());
        for (size_t i = 0; i < sortOrder.size(); i++) sortOrder[i] = i;
        std::sort(sortOrder.begin(), sortOrder.end(), [&](size_t a, size_t b) {
            return entries[a].archiveName < entries[b].archiveName;
        });

        std::vector<ZipIndexEntry> sortedEntries;
        sortedEntries.reserve(entries.size());
        for (size_t i = 0; i < sortOrder.size(); i++) {
            auto& current = entries[sortOrder[i]];
            if (current.rawPath.empty()) {
                sortedEntries.push_back({current.archiveName, ""});
                continue;
            }

            std::string ext = getExtensionZip(current.archiveName);
            if (ext.empty()) ext = ".bin";
            char finalName[32];
            snprintf(finalName, sizeof(finalName), "%06d%s", static_cast<int>(i), ext.c_str());
            std::string finalPath = rawDir + "/" + finalName;

            if (current.rawPath != finalPath) {
                std::error_code ec;
                fs::rename(current.rawPath, finalPath, ec);
                if (ec) {
                    fs::copy_file(current.rawPath, finalPath, fs::copy_options::overwrite_existing, ec);
                    fs::remove(current.rawPath, ec);
                }
            }

            sortedEntries.push_back({current.archiveName, finalPath});
        }

        entries = std::move(sortedEntries);
        return static_cast<int>(entries.size());
    }

    bool extractPreview(const std::string& archivePath, const std::string& rawDir,
                        int sortedIndex, std::string& outEntryName,
                        std::string& outRawRelativePath) override {
        if (sortedIndex < 0) return false;
        fs::create_directories(rawDir);

        std::vector<std::string> names;
        archive* listArc = archive_read_new();
        if (!listArc) return false;
        archive_read_support_filter_all(listArc);
        archive_read_support_format_zip(listArc);
        if (archive_read_open_filename(listArc, archivePath.c_str(), 10240) != ARCHIVE_OK) {
            archive_read_free(listArc);
            return false;
        }

        archive_entry* entry = nullptr;
        while (archive_read_next_header(listArc, &entry) == ARCHIVE_OK) {
            const char* pathname = archive_entry_pathname(entry);
            std::string name = pathname ? pathname : "";
            const bool isDir = archive_entry_filetype(entry) == AE_IFDIR;
            if (!isDir && isImageFileZip(name)) {
                names.push_back(name);
            }
            archive_read_data_skip(listArc);
        }
        archive_read_close(listArc);
        archive_read_free(listArc);

        if (names.empty() || sortedIndex >= static_cast<int>(names.size())) {
            return false;
        }

        std::sort(names.begin(), names.end());
        const std::string targetName = names[sortedIndex];
        std::string ext = getExtensionZip(targetName);
        if (ext.empty()) ext = ".bin";

        char finalName[32];
        snprintf(finalName, sizeof(finalName), "%06d%s", sortedIndex, ext.c_str());
        const std::string finalPath = rawDir + "/" + finalName;
        if (fs::exists(finalPath)) {
            outEntryName = targetName;
            outRawRelativePath = std::string("raw/") + finalName;
            return true;
        }

        archive* arc = archive_read_new();
        if (!arc) return false;
        archive_read_support_filter_all(arc);
        archive_read_support_format_zip(arc);
        if (archive_read_open_filename(arc, archivePath.c_str(), 10240) != ARCHIVE_OK) {
            archive_read_free(arc);
            return false;
        }

        bool extracted = false;
        while (archive_read_next_header(arc, &entry) == ARCHIVE_OK) {
            const char* pathname = archive_entry_pathname(entry);
            std::string name = pathname ? pathname : "";
            const bool isDir = archive_entry_filetype(entry) == AE_IFDIR;
            if (isDir || !isImageFileZip(name)) {
                archive_read_data_skip(arc);
                continue;
            }

            if (name != targetName) {
                archive_read_data_skip(arc);
                continue;
            }

            std::ofstream out(finalPath, std::ios::binary | std::ios::trunc);
            char chunk[64 * 1024];
            la_ssize_t bytesRead = 0;
            bool failed = false;
            while ((bytesRead = archive_read_data(arc, chunk, sizeof(chunk))) > 0) {
                out.write(chunk, static_cast<std::streamsize>(bytesRead));
                if (!out.good()) {
                    failed = true;
                    break;
                }
            }
            if (bytesRead < 0) failed = true;
            out.close();
            if (!failed && fs::exists(finalPath)) {
                extracted = true;
            } else {
                std::error_code ec;
                fs::remove(finalPath, ec);
            }
            break;
        }

        archive_read_close(arc);
        archive_read_free(arc);

        if (!extracted) return false;

        outEntryName = targetName;
        outRawRelativePath = std::string("raw/") + finalName;
        return true;
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
        if (entry.rawPath.empty() || !fs::exists(entry.rawPath)) return false;

        auto fileSize = fs::file_size(entry.rawPath);
        outData.resize(fileSize);
        std::ifstream in(entry.rawPath, std::ios::binary);
        if (!in) return false;
        in.read(reinterpret_cast<char*>(outData.data()), static_cast<std::streamsize>(fileSize));
        return true;
    }

    void close() override {
        entries.clear();
    }

private:
    std::string rawDir;
    std::vector<ZipIndexEntry> entries;
};

std::unique_ptr<ArchiveBackend> createZipBackend() {
    return std::make_unique<ZipBackend>();
}
