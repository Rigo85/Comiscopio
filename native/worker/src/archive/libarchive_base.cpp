#include "libarchive_base.h"

#include <algorithm>
#include <csignal>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <set>
#include <stdexcept>
#include <string>

namespace fs = std::filesystem;

static const std::set<std::string> IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".bmp", ".tiff", ".tif"
};

static std::string toLowerStr(const std::string& s) {
    std::string result = s;
    std::transform(result.begin(), result.end(), result.begin(), ::tolower);
    return result;
}

static std::string getExtension(const std::string& filename) {
    auto pos = filename.rfind('.');
    if (pos == std::string::npos) return "";
    return toLowerStr(filename.substr(pos));
}

static std::string getBasename(const std::string& path) {
    auto pos = path.find_last_of("/\\");
    return (pos == std::string::npos) ? path : path.substr(pos + 1);
}

static bool isJunkEntry(const std::string& filename) {
    const std::string base = getBasename(filename);
    // macOS resource forks & metadata
    if (base.rfind("._", 0) == 0) return true;
    if (filename.find("__MACOSX/") != std::string::npos) return true;
    // Windows thumbnail cache
    if (toLowerStr(base) == "thumbs.db" || toLowerStr(base) == "desktop.ini") return true;
    // Hidden dotfiles
    if (!base.empty() && base[0] == '.') return true;
    return false;
}

static bool isImageFile(const std::string& filename) {
    if (isJunkEntry(filename)) return false;
    return IMAGE_EXTENSIONS.count(getExtension(filename)) > 0;
}

static bool isCancelled(void* userData) {
    auto* ctx = reinterpret_cast<ArchiveCancelContext*>(userData);
    return ctx && ctx->flag && *ctx->flag != 0;
}

// --- Private helper ---

archive* LibarchiveBackend::openArchive(const std::string& archivePath) const {
    archive* arc = archive_read_new();
    if (!arc) {
        throw std::runtime_error(std::string("Failed to allocate libarchive reader for ") + formatLabel());
    }

    archive_read_support_filter_all(arc);
    configureFormat(arc);

    if (archive_read_open_filename(arc, archivePath.c_str(), 10240) != ARCHIVE_OK) {
        std::string message = archive_error_string(arc) ? archive_error_string(arc) : "unknown error";
        archive_read_free(arc);
        throw std::runtime_error(std::string("Failed to open ") + formatLabel() + " archive: " + message);
    }

    return arc;
}

// --- ArchiveBackend interface ---

int LibarchiveBackend::open(const std::string& archivePath, const std::string& rawDir,
                            ProgressCb progressCb, void* userData) {
    this->rawDir = rawDir;
    entries.clear();
    fs::create_directories(rawDir);

    archive* arc = openArchive(archivePath);
    archive_entry* entry = nullptr;
    int imageCount = 0;

    while (archive_read_next_header(arc, &entry) == ARCHIVE_OK) {
        if (isCancelled(userData)) {
            break;
        }

        const char* pathname = archive_entry_pathname(entry);
        std::string name = pathname ? pathname : "";
        const bool isDir = archive_entry_filetype(entry) == AE_IFDIR;

        if (!isDir && !isImageFile(name)) {
            archive_read_data_skip(arc);
            continue;
        }
        if (isDir) {
            archive_read_data_skip(arc);
            continue;
        }

        std::string ext = getExtension(name);
        if (ext.empty()) ext = ".bin";

        char tmpName[32];
        snprintf(tmpName, sizeof(tmpName), "raw_%06d%s", imageCount, ext.c_str());
        std::string rawPath = rawDir + "/" + tmpName;

        // Stream directly to disk
        std::ofstream out(rawPath, std::ios::binary | std::ios::trunc);
        char chunk[64 * 1024];
        la_ssize_t bytesRead = 0;
        bool failed = false;
        bool cancelled = false;

        if (!out) {
            failed = true;
        } else {
            while ((bytesRead = archive_read_data(arc, chunk, sizeof(chunk))) > 0) {
                if (isCancelled(userData)) {
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

    // Sort entries by archive name and rename to sorted indices
    std::vector<size_t> sortOrder(entries.size());
    for (size_t i = 0; i < sortOrder.size(); i++) sortOrder[i] = i;
    std::sort(sortOrder.begin(), sortOrder.end(), [&](size_t a, size_t b) {
        return entries[a].archiveName < entries[b].archiveName;
    });

    std::vector<LibarchiveIndexEntry> sortedEntries;
    sortedEntries.reserve(entries.size());
    for (size_t i = 0; i < sortOrder.size(); i++) {
        auto& current = entries[sortOrder[i]];
        if (current.rawPath.empty()) {
            sortedEntries.push_back({current.archiveName, ""});
            continue;
        }

        std::string ext = getExtension(current.archiveName);
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

bool LibarchiveBackend::extractPreview(const std::string& archivePath, const std::string& rawDir,
                                       int sortedIndex, std::string& outEntryName,
                                       std::string& outRawRelativePath) {
    if (sortedIndex < 0) return false;
    fs::create_directories(rawDir);

    // Pass 1: list image names
    std::vector<std::string> names;
    archive* listArc = openArchive(archivePath);

    archive_entry* entry = nullptr;
    while (archive_read_next_header(listArc, &entry) == ARCHIVE_OK) {
        const char* pathname = archive_entry_pathname(entry);
        std::string name = pathname ? pathname : "";
        const bool isDir = archive_entry_filetype(entry) == AE_IFDIR;
        if (!isDir && isImageFile(name)) {
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
    std::string ext = getExtension(targetName);
    if (ext.empty()) ext = ".bin";

    char finalName[32];
    snprintf(finalName, sizeof(finalName), "%06d%s", sortedIndex, ext.c_str());
    const std::string finalPath = rawDir + "/" + finalName;
    if (fs::exists(finalPath)) {
        outEntryName = targetName;
        outRawRelativePath = std::string("raw/") + finalName;
        return true;
    }

    // Pass 2: extract the target entry
    archive* arc = openArchive(archivePath);

    bool extracted = false;
    while (archive_read_next_header(arc, &entry) == ARCHIVE_OK) {
        const char* pathname = archive_entry_pathname(entry);
        std::string name = pathname ? pathname : "";
        const bool isDir = archive_entry_filetype(entry) == AE_IFDIR;
        if (isDir || !isImageFile(name)) {
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

int LibarchiveBackend::entryCount() const {
    return static_cast<int>(entries.size());
}

std::string LibarchiveBackend::entryName(int index) const {
    if (index < 0 || index >= static_cast<int>(entries.size())) return "";
    return entries[index].archiveName;
}

bool LibarchiveBackend::getEntry(int index, std::vector<uint8_t>& outData) const {
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

void LibarchiveBackend::close() {
    entries.clear();
}
