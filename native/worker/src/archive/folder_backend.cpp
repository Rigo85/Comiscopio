#include "archive_backend.h"
#include "archive_entry_utils.h"
#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <memory>
#include <stdexcept>

namespace fs = std::filesystem;

class FolderBackend : public ArchiveBackend {
    std::vector<std::string> names;
    fs::path raw;

    static std::vector<std::string> list(const fs::path& root) {
        std::vector<std::string> result;
        for (auto it = fs::recursive_directory_iterator(root); it != fs::recursive_directory_iterator(); ++it) {
            const auto name = it->path().lexically_relative(root).generic_u8string();
            if (it->is_symlink() || isJunkArchiveEntry(name)) {
                if (it->is_directory()) it.disable_recursion_pending();
                continue;
            }
            if (it->is_regular_file() && isImageArchiveEntry(name)) result.push_back(name);
        }
        std::sort(result.begin(), result.end(), naturalArchivePathLess);
        return result;
    }

    static std::string numbered(int index, const std::string& name) {
        char number[24];
        std::snprintf(number, sizeof(number), "%06d", index);
        return std::string(number) + archiveExtension(name);
    }

public:
    int open(const std::string& input, const std::string& rawDir, ProgressCb progress = nullptr, void* user = nullptr) override {
        close();
        const auto root = fs::u8path(input);
        names = list(root);
        raw = fs::u8path(rawDir);
        fs::create_directories(raw);
        for (int i = 0; i < static_cast<int>(names.size()); ++i) {
            auto* cancel = static_cast<ArchiveCancelContext*>(user);
            if (cancel && cancel->flag && *cancel->flag) break;
            fs::copy_file(root / fs::u8path(names[i]), raw / fs::u8path(numbered(i, names[i])), fs::copy_options::overwrite_existing);
            if (progress) progress(i, static_cast<int>(names.size()), names[i], user);
        }
        return static_cast<int>(names.size());
    }

    bool extractPreview(const std::string& input, const std::string& rawDir, int index,
                        std::string& entry, std::string& relative) override {
        const auto root = fs::u8path(input);
        const auto entries = list(root);
        if (index < 0 || index >= static_cast<int>(entries.size())) return false;
        entry = entries[index];
        const auto filename = numbered(index, entry);
        fs::create_directories(fs::u8path(rawDir));
        fs::copy_file(root / fs::u8path(entry), fs::u8path(rawDir) / filename, fs::copy_options::overwrite_existing);
        relative = "raw/" + filename;
        return true;
    }

    int entryCount() const override { return static_cast<int>(names.size()); }
    std::string entryName(int index) const override { return names.at(index); }
    bool getEntry(int index, std::vector<uint8_t>& data) const override {
        std::ifstream in(raw / fs::u8path(numbered(index, names.at(index))), std::ios::binary | std::ios::ate);
        if (!in) return false;
        auto size = in.tellg();
        if (size <= 0) return false;
        data.resize(static_cast<size_t>(size));
        in.seekg(0);
        return static_cast<bool>(in.read(reinterpret_cast<char*>(data.data()), static_cast<std::streamsize>(data.size())));
    }
    void close() override { names.clear(); raw.clear(); }
};

std::unique_ptr<ArchiveBackend> createFolderBackend() { return std::make_unique<FolderBackend>(); }
