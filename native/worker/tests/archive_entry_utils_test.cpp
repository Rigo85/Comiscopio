#include "archive_entry_utils.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace {

void fail(const std::string& message) {
    std::cerr << "FAIL: " << message << std::endl;
    std::exit(1);
}

void assertTrue(bool value, const std::string& message) {
    if (!value) fail(message);
}

void assertEq(const std::string& actual, const std::string& expected, const std::string& label) {
    if (actual != expected) {
        fail(label + " expected='" + expected + "' actual='" + actual + "'");
    }
}

void assertEqSize(std::size_t actual, std::size_t expected, const std::string& label) {
    if (actual != expected) {
        fail(label + " expected=" + std::to_string(expected) + " actual=" + std::to_string(actual));
    }
}

void writeDummyFile(const fs::path& path, const std::string& content) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << content;
}

void testNormalizeArchivePath() {
    assertEq(normalizeArchivePath("./Cap_01\\001.PNG"), "cap_01/001.png", "normalize mixed separators");
    assertEq(normalizeArchivePath("//ROOT///A/B/"), "root/a/b", "normalize leading and duplicate slashes");
}

void testJunkAndImageFiltering() {
    assertTrue(isImageArchiveEntry("Comic/001.JPEG"), "jpeg image detected");
    assertTrue(!isImageArchiveEntry("__MACOSX/._001.PNG"), "macOS resource fork ignored");
    assertTrue(!isImageArchiveEntry("folder/.DS_Store"), "dotfile ignored");
    assertTrue(!isImageArchiveEntry("folder/Thumbs.db"), "thumbs db ignored");
    assertTrue(!isImageArchiveEntry("folder/ComicInfo.xml"), "sidecar xml ignored");
}

void testNaturalArchivePathLess() {
    assertTrue(naturalArchivePathLess("cap_2/001.png", "cap_10/001.png"), "numeric natural sort");
    assertTrue(naturalArchivePathLess("cap_01/0002.png", "cap_02/0001.png"), "folder order before page order");
    assertTrue(naturalArchivePathLess("cap_01/0001.png", "extras/0001.png"), "extras after cap folders");
}

void testSortAndRenameEntries() {
    const fs::path tmpBase = fs::temp_directory_path() / "comiscopio-archive-entry-utils-test";
    std::error_code ec;
    fs::remove_all(tmpBase, ec);
    fs::create_directories(tmpBase, ec);
    if (ec) fail("failed to create temp directory");

    const fs::path raw0 = tmpBase / "raw_z.png";
    const fs::path raw1 = tmpBase / "raw_b.png";
    const fs::path raw2 = tmpBase / "raw_a.png";
    const fs::path raw3 = tmpBase / "raw_e.png";

    writeDummyFile(raw0, "z");
    writeDummyFile(raw1, "b");
    writeDummyFile(raw2, "a");
    writeDummyFile(raw3, "e");

    std::vector<CanonicalArchiveEntry> input = {
        {"cap_10/0001.png", "cap_10/0001.png", raw0.string()},
        {"cap_01/0002.png", "cap_01/0002.png", raw1.string()},
        {"cap_01/0001.png", "cap_01/0001.png", raw2.string()},
        {"extras/0001.png", "extras/0001.png", raw3.string()},
        {"cap_02/0001.png", "cap_02/0001.png", ""},
    };

    auto sorted = sortAndRenameEntries(tmpBase.string(), std::move(input));

    assertEqSize(sorted.size(), 5, "sorted entries size");
    assertEq(sorted[0].archivePath, "cap_01/0001.png", "sorted[0] archive path");
    assertEq(sorted[1].archivePath, "cap_01/0002.png", "sorted[1] archive path");
    assertEq(sorted[2].archivePath, "cap_02/0001.png", "sorted[2] archive path");
    assertEq(sorted[3].archivePath, "cap_10/0001.png", "sorted[3] archive path");
    assertEq(sorted[4].archivePath, "extras/0001.png", "sorted[4] archive path");

    assertTrue(sorted[2].rawPath.empty(), "missing raw path preserved");
    assertTrue(fs::exists(tmpBase / "000000.png"), "first file renamed");
    assertTrue(fs::exists(tmpBase / "000001.png"), "second file renamed");
    assertTrue(fs::exists(tmpBase / "000003.png"), "fourth file renamed");
    assertTrue(fs::exists(tmpBase / "000004.png"), "fifth file renamed");

    fs::remove_all(tmpBase, ec);
}

}  // namespace

int main() {
    testNormalizeArchivePath();
    testJunkAndImageFiltering();
    testNaturalArchivePathLess();
    testSortAndRenameEntries();
    std::cout << "archive_entry_utils_test OK" << std::endl;
    return 0;
}
