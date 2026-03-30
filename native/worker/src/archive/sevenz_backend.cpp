#include "archive_backend.h"
#include "archive_entry_utils.h"

#include <algorithm>
#include <memory>
#include <csignal>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <utility>
#include <vector>

extern "C" {
#include "7z.h"
#include "7zAlloc.h"
#include "7zCrc.h"
#include "7zFile.h"
}

namespace {

static const ISzAlloc kSevenZipAlloc = { SzAlloc, SzFree };

struct SevenZipIndexedEntry {
    UInt32 archiveIndex = 0;
    CanonicalArchiveEntry entry;
};

size_t utf16ToUtf8Calc(const UInt16* src, const UInt16* srcLim) {
    size_t size = 0;
    while (src != srcLim) {
        UInt32 value = *src++;
        size++;

        if (value < 0x80) continue;
        if (value < (1u << 11)) {
            size++;
            continue;
        }

        if (value >= 0xD800 && value < 0xDC00 && src != srcLim) {
            const UInt32 c2 = *src;
            if (c2 >= 0xDC00 && c2 < 0xE000) {
                src++;
                size += 3;
                continue;
            }
        }

        size += 2;
    }
    return size;
}

std::string utf16ToUtf8(const UInt16* src, size_t len) {
    std::string out;
    out.resize(utf16ToUtf8Calc(src, src + len));
    size_t offset = 0;

    while (len > 0) {
        UInt32 value = *src++;
        len--;

        if (value < 0x80) {
            out[offset++] = static_cast<char>(value);
            continue;
        }

        if (value < (1u << 11)) {
            out[offset++] = static_cast<char>(0xC0 | (value >> 6));
            out[offset++] = static_cast<char>(0x80 | (value & 0x3F));
            continue;
        }

        if (value >= 0xD800 && value < 0xDC00 && len > 0) {
            const UInt32 c2 = *src;
            if (c2 >= 0xDC00 && c2 < 0xE000) {
                src++;
                len--;
                value = (((value - 0xD800) << 10) | (c2 - 0xDC00)) + 0x10000;
                out[offset++] = static_cast<char>(0xF0 | (value >> 18));
                out[offset++] = static_cast<char>(0x80 | ((value >> 12) & 0x3F));
                out[offset++] = static_cast<char>(0x80 | ((value >> 6) & 0x3F));
                out[offset++] = static_cast<char>(0x80 | (value & 0x3F));
                continue;
            }
        }

        out[offset++] = static_cast<char>(0xE0 | (value >> 12));
        out[offset++] = static_cast<char>(0x80 | ((value >> 6) & 0x3F));
        out[offset++] = static_cast<char>(0x80 | (value & 0x3F));
    }

    return out;
}

class SevenZipReader {
public:
    explicit SevenZipReader(const std::string& archivePath) {
        CrcGenerateTable();
        File_Construct(&archiveStream.file);
        SzArEx_Init(&db);

        const WRes openResult = InFile_Open(&archiveStream.file, archivePath.c_str());
        if (openResult != 0) {
            throw std::runtime_error("Failed to open 7z archive: " + archivePath);
        }

        FileInStream_CreateVTable(&archiveStream);
        archiveStream.wres = 0;
        LookToRead2_CreateVTable(&lookStream, False);
        lookStream.buf = static_cast<Byte*>(ISzAlloc_Alloc(&allocMain, kInputBufSize));
        if (!lookStream.buf) {
            throw std::runtime_error("Failed to allocate 7z input buffer");
        }

        lookStream.bufSize = kInputBufSize;
        lookStream.realStream = &archiveStream.vt;
        LookToRead2_INIT(&lookStream);

        const SRes result = SzArEx_Open(&db, &lookStream.vt, &allocMain, &allocTemp);
        if (result != SZ_OK) {
            throw std::runtime_error("Failed to parse 7z archive");
        }
    }

    ~SevenZipReader() {
        ISzAlloc_Free(&allocMain, outBuffer);
        SzArEx_Free(&db, &allocMain);
        ISzAlloc_Free(&allocMain, lookStream.buf);
        File_Close(&archiveStream.file);
    }

    UInt32 fileCount() const {
        return db.NumFiles;
    }

    bool isDir(UInt32 index) const {
        return SzArEx_IsDir(&db, index) != 0;
    }

    std::string fileName(UInt32 index) const {
        const size_t required = SzArEx_GetFileNameUtf16(&db, index, nullptr);
        if (required == 0) return "";

        std::vector<UInt16> wide(required);
        SzArEx_GetFileNameUtf16(&db, index, wide.data());

        size_t actualLen = 0;
        while (actualLen < wide.size() && wide[actualLen] != 0) {
            actualLen++;
        }

        return utf16ToUtf8(wide.data(), actualLen);
    }

    bool extractToFile(UInt32 index, const std::string& destinationPath) {
        size_t offset = 0;
        size_t outSizeProcessed = 0;

        const SRes result = SzArEx_Extract(
            &db,
            &lookStream.vt,
            index,
            &blockIndex,
            &outBuffer,
            &outBufferSize,
            &offset,
            &outSizeProcessed,
            &allocMain,
            &allocTemp);

        if (result != SZ_OK) {
            return false;
        }

        std::ofstream out(destinationPath, std::ios::binary | std::ios::trunc);
        if (!out) {
            return false;
        }

        out.write(reinterpret_cast<const char*>(outBuffer + offset), static_cast<std::streamsize>(outSizeProcessed));
        return out.good();
    }

private:
    static constexpr size_t kInputBufSize = static_cast<size_t>(1) << 18;

    ISzAlloc allocMain = kSevenZipAlloc;
    ISzAlloc allocTemp = kSevenZipAlloc;
    CFileInStream archiveStream{};
    CLookToRead2 lookStream{};
    CSzArEx db{};
    UInt32 blockIndex = 0xFFFFFFFF;
    Byte* outBuffer = nullptr;
    size_t outBufferSize = 0;
};

bool isCancelled(void* userData) {
    auto* ctx = reinterpret_cast<ArchiveCancelContext*>(userData);
    return ctx && ctx->flag && *ctx->flag != 0;
}

std::vector<SevenZipIndexedEntry> collectSevenZipImageEntries(SevenZipReader& reader) {
    std::vector<SevenZipIndexedEntry> entries;
    entries.reserve(reader.fileCount());

    for (UInt32 index = 0; index < reader.fileCount(); index++) {
        if (reader.isDir(index)) continue;

        const std::string archivePath = reader.fileName(index);
        if (!isImageArchiveEntry(archivePath)) {
            continue;
        }

        entries.push_back({
            index,
            {
                archivePath,
                normalizeArchivePath(archivePath),
                "",
            }
        });
    }

    std::sort(entries.begin(), entries.end(), [](const SevenZipIndexedEntry& lhs, const SevenZipIndexedEntry& rhs) {
        return naturalArchivePathLess(lhs.entry.sortKey, rhs.entry.sortKey);
    });
    return entries;
}

} // namespace

class SevenZBackend : public ArchiveBackend {
public:
    int open(const std::string& archivePath, const std::string& rawDir,
             ProgressCb progressCb, void* userData) override {
        this->rawDir = rawDir;
        entries.clear();
        std::filesystem::create_directories(rawDir);

        SevenZipReader reader(archivePath);
        auto indexedEntries = collectSevenZipImageEntries(reader);
        entries.reserve(indexedEntries.size());

        for (size_t i = 0; i < indexedEntries.size(); i++) {
            if (isCancelled(userData)) {
                break;
            }

            auto& indexed = indexedEntries[i];
            std::string ext = archiveExtension(indexed.entry.archivePath);
            if (ext.empty()) ext = ".bin";

            char tmpName[32];
            std::snprintf(tmpName, sizeof(tmpName), "raw_%06d%s", static_cast<int>(i), ext.c_str());
            std::string rawPath = rawDir + "/" + tmpName;

            if (reader.extractToFile(indexed.archiveIndex, rawPath)) {
                indexed.entry.rawPath = rawPath;
            } else {
                indexed.entry.rawPath.clear();
            }

            entries.push_back(indexed.entry);

            if (progressCb) {
                progressCb(static_cast<int>(i), -1, indexed.entry.archivePath, userData);
            }
        }

        entries = sortAndRenameEntries(rawDir, std::move(entries));
        return static_cast<int>(entries.size());
    }

    bool extractPreview(const std::string& archivePath, const std::string& rawDir,
                        int sortedIndex, std::string& outEntryName,
                        std::string& outRawRelativePath) override {
        if (sortedIndex < 0) return false;
        std::filesystem::create_directories(rawDir);

        SevenZipReader reader(archivePath);
        auto indexedEntries = collectSevenZipImageEntries(reader);
        if (sortedIndex >= static_cast<int>(indexedEntries.size())) {
            return false;
        }

        const auto& target = indexedEntries[sortedIndex];
        std::string ext = archiveExtension(target.entry.archivePath);
        if (ext.empty()) ext = ".bin";

        char finalName[32];
        std::snprintf(finalName, sizeof(finalName), "%06d%s", sortedIndex, ext.c_str());
        const std::string finalPath = rawDir + "/" + finalName;

        if (!std::filesystem::exists(finalPath) && !reader.extractToFile(target.archiveIndex, finalPath)) {
            std::error_code ec;
            std::filesystem::remove(finalPath, ec);
            return false;
        }

        outEntryName = target.entry.archivePath;
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
        if (entry.rawPath.empty() || !std::filesystem::exists(entry.rawPath)) return false;

        const auto fileSize = std::filesystem::file_size(entry.rawPath);
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
    std::vector<CanonicalArchiveEntry> entries;
};

std::unique_ptr<ArchiveBackend> createSevenZBackend() {
    return std::make_unique<SevenZBackend>();
}
