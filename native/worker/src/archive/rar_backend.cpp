#include "archive_backend.h"
#include "unrar_compat.h"

#include <algorithm>
#include <cctype>
#include <csignal>
#include <cstdio>
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

static std::string toLower(const std::string& s) {
    std::string result = s;
    std::transform(result.begin(), result.end(), result.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return result;
}

static std::string getExtension(const std::string& filename) {
    auto pos = filename.rfind('.');
    if (pos == std::string::npos) return "";
    return toLower(filename.substr(pos));
}

static std::string getBasename(const std::string& path) {
    auto pos = path.find_last_of("/\\");
    return (pos == std::string::npos) ? path : path.substr(pos + 1);
}

static bool isJunkEntry(const std::string& filename) {
    const std::string base = getBasename(filename);
    if (base.rfind("._", 0) == 0) return true;
    if (filename.find("__MACOSX/") != std::string::npos) return true;
    if (toLower(base) == "thumbs.db" || toLower(base) == "desktop.ini") return true;
    if (!base.empty() && base[0] == '.') return true;
    return false;
}

static bool isImageFile(const std::string& filename) {
    if (isJunkEntry(filename)) return false;
    return IMAGE_EXTENSIONS.count(getExtension(filename)) > 0;
}

struct RarIndexEntry {
    std::string archiveName;
    std::string rawPath;
};

class RarBackend : public ArchiveBackend {
public:
    int open(const std::string& archivePath, const std::string& rawDir,
             ProgressCb progressCb, void* userData) override {
        this->rawDir = rawDir;
        entries.clear();
        fs::create_directories(rawDir);

        std::vector<RarIndexEntry> extractedEntries;
        extractedEntries.reserve(1024);

        openArchive(archivePath, [&](HANDLE hArc) {
            auto* cancelContext = reinterpret_cast<ArchiveCancelContext*>(userData);
            cancelFlag = cancelContext ? cancelContext->flag : nullptr;
            RARHeaderDataEx header{};
            int imageCount = 0;

            while (!isCancelled() && RARReadHeaderEx(hArc, &header) == 0) {
                std::string name(header.FileName);
                const bool isDir = (header.Flags & RHDF_DIRECTORY) != 0;
                const bool isImage = !isDir && isImageFile(name);

                if (!isImage) {
                    RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
                    continue;
                }

                std::string ext = getExtension(name);
                if (ext.empty()) ext = ".bin";

                char tmpName[32];
                snprintf(tmpName, sizeof(tmpName), "raw_%06d%s", imageCount, ext.c_str());
                std::string rawPath = rawDir + "/" + tmpName;

                beginStreamingWrite(rawPath);
                const int result = RARProcessFile(hArc, RAR_TEST, nullptr, nullptr);
                finishStreamingWrite(result == 0);

                if (isCancelled()) {
                    break;
                }

                if (result == 0 && lastWriteOk && fs::exists(rawPath)) {
                    extractedEntries.push_back({name, rawPath});
                } else {
                    extractedEntries.push_back({name, ""});
                }

                if (progressCb) {
                    progressCb(imageCount, -1, name, userData);
                }
                imageCount++;
            }
        });
        cancelFlag = nullptr;

        entries = sortAndRename(rawDir, std::move(extractedEntries));
        return static_cast<int>(entries.size());
    }

    bool extractPreview(const std::string& archivePath, const std::string& rawDir,
                        int sortedIndex, std::string& outEntryName,
                        std::string& outRawRelativePath) override {
        if (sortedIndex < 0) return false;
        fs::create_directories(rawDir);

        std::vector<std::string> names;
        openArchive(archivePath, [&](HANDLE hArc) {
            RARHeaderDataEx header{};
            while (RARReadHeaderEx(hArc, &header) == 0) {
                std::string name(header.FileName);
                const bool isDir = (header.Flags & RHDF_DIRECTORY) != 0;
                if (!isDir && isImageFile(name)) {
                    names.push_back(name);
                }
                RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
            }
        });

        if (names.empty() || sortedIndex >= static_cast<int>(names.size())) {
            return false;
        }

        std::sort(names.begin(), names.end());
        const std::string targetName = names[sortedIndex];
        const std::string ext = getExtension(targetName).empty() ? ".bin" : getExtension(targetName);

        char finalName[32];
        snprintf(finalName, sizeof(finalName), "%06d%s", sortedIndex, ext.c_str());
        const std::string finalPath = rawDir + "/" + finalName;
        if (fs::exists(finalPath)) {
            outEntryName = targetName;
            outRawRelativePath = std::string("raw/") + finalName;
            return true;
        }

        bool extracted = false;
        openArchive(archivePath, [&](HANDLE hArc) {
            RARHeaderDataEx header{};
            while (RARReadHeaderEx(hArc, &header) == 0) {
                std::string name(header.FileName);
                const bool isDir = (header.Flags & RHDF_DIRECTORY) != 0;
                if (isDir || !isImageFile(name)) {
                    RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
                    continue;
                }

                if (name == targetName) {
                    beginStreamingWrite(finalPath);
                    const int result = RARProcessFile(hArc, RAR_TEST, nullptr, nullptr);
                    finishStreamingWrite(result == 0);
                    extracted = (result == 0 && lastWriteOk && fs::exists(finalPath));
                    break;
                }

                RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
            }
        });

        if (!extracted) {
            std::error_code ec;
            fs::remove(finalPath, ec);
            return false;
        }

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

        const auto fileSize = fs::file_size(entry.rawPath);
        outData.resize(fileSize);
        std::ifstream in(entry.rawPath, std::ios::binary);
        if (!in) return false;
        in.read(reinterpret_cast<char*>(outData.data()), static_cast<std::streamsize>(fileSize));
        return true;
    }

    void close() override {
        entries.clear();
        closeCurrentStream();
    }

private:
    template <typename Fn>
    void openArchive(const std::string& archivePath, Fn&& fn) {
        RAROpenArchiveDataEx arcData{};
        arcData.ArcName = const_cast<char*>(archivePath.c_str());
        arcData.OpenMode = RAR_OM_EXTRACT;

        HANDLE hArc = RAROpenArchiveEx(&arcData);
        if (!hArc || arcData.OpenResult != 0) {
            throw std::runtime_error("Failed to open RAR archive: " + archivePath);
        }

        RARSetCallback(hArc, extractCallback, reinterpret_cast<LPARAM>(this));
        try {
            fn(hArc);
            RARCloseArchive(hArc);
        } catch (...) {
            RARCloseArchive(hArc);
            throw;
        }
    }

    void beginStreamingWrite(const std::string& path) {
        closeCurrentStream();
        currentOutputPath = path;
        currentOutput.open(path, std::ios::binary | std::ios::trunc);
        lastWriteOk = currentOutput.is_open();
    }

    void finishStreamingWrite(bool ok) {
        if (currentOutput.is_open()) {
            currentOutput.flush();
            currentOutput.close();
        }
        if (!ok || !lastWriteOk) {
            std::error_code ec;
            fs::remove(currentOutputPath, ec);
        }
        currentOutputPath.clear();
    }

    void closeCurrentStream() {
        if (currentOutput.is_open()) {
            currentOutput.close();
        }
        currentOutputPath.clear();
        lastWriteOk = true;
    }

    bool isCancelled() const {
        return cancelFlag && *cancelFlag != 0;
    }

    static int CALLBACK extractCallback(UINT msg, LPARAM userData, LPARAM p1, LPARAM p2) {
        if (msg != UCM_PROCESSDATA) return 1;

        auto* self = reinterpret_cast<RarBackend*>(userData);
        if (self->isCancelled()) {
            self->lastWriteOk = false;
            return -1;
        }
        if (!self->currentOutput.is_open()) {
            self->lastWriteOk = false;
            return -1;
        }

        self->currentOutput.write(reinterpret_cast<const char*>(p1), static_cast<std::streamsize>(p2));
        if (!self->currentOutput.good()) {
            self->lastWriteOk = false;
            return -1;
        }

        return 1;
    }

    static std::vector<RarIndexEntry> sortAndRename(const std::string& rawDir,
                                                    std::vector<RarIndexEntry>&& input) {
        std::vector<size_t> sortOrder(input.size());
        for (size_t i = 0; i < sortOrder.size(); i++) sortOrder[i] = i;

        std::sort(sortOrder.begin(), sortOrder.end(), [&](size_t a, size_t b) {
            return input[a].archiveName < input[b].archiveName;
        });

        std::vector<RarIndexEntry> sortedEntries;
        sortedEntries.reserve(input.size());
        for (size_t i = 0; i < sortOrder.size(); i++) {
            auto& entry = input[sortOrder[i]];
            if (entry.rawPath.empty()) {
                sortedEntries.push_back({entry.archiveName, ""});
                continue;
            }

            std::string ext = getExtension(entry.archiveName);
            if (ext.empty()) ext = ".bin";

            char finalName[32];
            snprintf(finalName, sizeof(finalName), "%06d%s", static_cast<int>(i), ext.c_str());
            std::string finalPath = rawDir + "/" + finalName;

            if (entry.rawPath != finalPath) {
                std::error_code ec;
                fs::rename(entry.rawPath, finalPath, ec);
                if (ec) {
                    fs::copy_file(entry.rawPath, finalPath, fs::copy_options::overwrite_existing, ec);
                    fs::remove(entry.rawPath, ec);
                }
            }

            sortedEntries.push_back({entry.archiveName, finalPath});
        }

        return sortedEntries;
    }

    std::string rawDir;
    std::vector<RarIndexEntry> entries;
    std::ofstream currentOutput;
    std::string currentOutputPath;
    bool lastWriteOk = true;
    volatile sig_atomic_t* cancelFlag = nullptr;
};

std::unique_ptr<ArchiveBackend> createRarBackend() {
    return std::make_unique<RarBackend>();
}
