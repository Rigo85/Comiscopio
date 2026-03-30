#include "archive_backend.h"
#include "archive_entry_utils.h"
#include "unrar_compat.h"

#include <algorithm>
#include <csignal>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;

class RarBackend : public ArchiveBackend {
public:
    int open(const std::string& archivePath, const std::string& rawDir,
             ProgressCb progressCb, void* userData) override {
        this->rawDir = rawDir;
        entries.clear();
        fs::create_directories(rawDir);

        std::vector<CanonicalArchiveEntry> extractedEntries;
        extractedEntries.reserve(1024);

        openArchive(archivePath, [&](HANDLE hArc) {
            auto* cancelContext = reinterpret_cast<ArchiveCancelContext*>(userData);
            cancelFlag = cancelContext ? cancelContext->flag : nullptr;
            RARHeaderDataEx header{};
            int imageCount = 0;

            while (!isCancelled() && RARReadHeaderEx(hArc, &header) == 0) {
                std::string name = normalizeArchivePath(header.FileName);
                const bool isDir = (header.Flags & RHDF_DIRECTORY) != 0;
                const bool isImage = !isDir && isImageArchiveEntry(name);

                if (!isImage) {
                    RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
                    continue;
                }

                std::string ext = archiveExtension(name);
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
                    extractedEntries.push_back({name, name, rawPath});
                } else {
                    extractedEntries.push_back({name, name, ""});
                }

                if (progressCb) {
                    progressCb(imageCount, -1, name, userData);
                }
                imageCount++;
            }
        });
        cancelFlag = nullptr;

        entries = sortAndRenameEntries(rawDir, std::move(extractedEntries));
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
                std::string name = normalizeArchivePath(header.FileName);
                const bool isDir = (header.Flags & RHDF_DIRECTORY) != 0;
                if (!isDir && isImageArchiveEntry(name)) {
                    names.push_back(name);
                }
                RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
            }
        });

        if (names.empty() || sortedIndex >= static_cast<int>(names.size())) {
            return false;
        }

        std::sort(names.begin(), names.end(), naturalArchivePathLess);
        const std::string targetName = names[sortedIndex];
        std::string ext = archiveExtension(targetName);
        if (ext.empty()) ext = ".bin";

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
                std::string name = normalizeArchivePath(header.FileName);
                const bool isDir = (header.Flags & RHDF_DIRECTORY) != 0;
                if (isDir || !isImageArchiveEntry(name)) {
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
        return entries[index].archivePath;
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

    std::string rawDir;
    std::vector<CanonicalArchiveEntry> entries;
    std::ofstream currentOutput;
    std::string currentOutputPath;
    bool lastWriteOk = true;
    volatile sig_atomic_t* cancelFlag = nullptr;
};

std::unique_ptr<ArchiveBackend> createRarBackend() {
    return std::make_unique<RarBackend>();
}
