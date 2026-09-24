#include "archive_backend.h"

#include <chrono>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;
std::unique_ptr<ArchiveBackend> createSevenZBackend();
static void check(bool ok) {
    if (!ok) throw std::runtime_error("7z reader lifetime regression");
}

int main(int argc, char** argv) {
    check(argc == 2);
    const fs::path fixtures = argv[1];
    const auto output = fs::temp_directory_path() / ("comiscopio-sevenz-test-" +
        std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    struct Cleanup {
        fs::path path;
        ~Cleanup() { std::error_code ec; fs::remove_all(path, ec); }
    } cleanup{output};
    fs::create_directories(output);
    const auto first = (fixtures / "test-5pages.cb7").string();
    const auto second = (fixtures / "test-multifolder.cb7").string();
    auto backend = createSevenZBackend();
    std::string name, relative;

    // Reuse the preview instance and compare every extracted byte with a fresh
    // reader, including when open() selects a different archive than preview.
    for (const auto& input : {first, second}) {
        check(backend->extractPreview(first, (output / "preview").string(), 0, name, relative));
        auto reference = createSevenZBackend();
        const int expected = reference->open(input, (output / "reference").string());
        check(expected > 0);
        check(backend->open(input, (output / "actual").string()) == expected);
        for (int page = 0; page < expected; ++page) {
            check(backend->entryName(page) == reference->entryName(page));
            std::vector<uint8_t> actualBytes, expectedBytes;
            check(backend->getEntry(page, actualBytes));
            check(reference->getEntry(page, expectedBytes));
            check(actualBytes == expectedBytes);
        }
        backend->close();
    }

    // Cancellation must discard the retained reader; reopening stays usable.
    check(backend->extractPreview(first, (output / "cancel").string(), 0, name, relative));
    volatile sig_atomic_t cancelled = 1;
    ArchiveCancelContext context{&cancelled};
    check(backend->open(first, (output / "cancel").string(), nullptr, &context) == 0);
    check(backend->open(first, (output / "reopen").string()) == 5);
    backend->close();

    check(backend->extractPreview(first, (output / "close").string(), 0, name, relative));
    backend->close();
    check(backend->entryCount() == 0);
    check(backend->open(second, (output / "after-close").string()) > 0);
    backend->close();
    check(!backend->extractPreview(first, (output / "invalid").string(), 9999, name, relative));
    check(backend->open(first, (output / "after-invalid").string()) == 5);
}
