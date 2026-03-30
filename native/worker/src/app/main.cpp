#include "archive_backend.h"
#include "image_pipeline.h"
#include "placeholder.h"
#include "manifest.h"
#include "progress.h"
#include "work_queue.h"

#include <vips/vips.h>
#include <nlohmann/json.hpp>

#include <chrono>
#include <clocale>
#include <cstdarg>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <string>

#ifndef _WIN32
#include <poll.h>
#include <unistd.h>
#include <malloc.h>  // malloc_trim
#endif

namespace fs = std::filesystem;
using json = nlohmann::json;

static constexpr double kSlowPageLogThresholdMs = 150.0;
static constexpr double kVerySlowPageLogThresholdMs = 300.0;

static std::string isoTimestampUtc() {
    using namespace std::chrono;
    const auto now = system_clock::now();
    const auto seconds = time_point_cast<std::chrono::seconds>(now);
    const auto millis = duration_cast<milliseconds>(now - seconds).count();
    const std::time_t timeValue = system_clock::to_time_t(now);
    std::tm tmUtc{};
#ifdef _WIN32
    gmtime_s(&tmUtc, &timeValue);
#else
    gmtime_r(&timeValue, &tmUtc);
#endif

    char buffer[80];
    std::snprintf(
        buffer,
        sizeof(buffer),
        "%04d-%02d-%02dT%02d:%02d:%02d.%03lldZ",
        tmUtc.tm_year + 1900,
        tmUtc.tm_mon + 1,
        tmUtc.tm_mday,
        tmUtc.tm_hour,
        tmUtc.tm_min,
        tmUtc.tm_sec,
        static_cast<long long>(millis));
    return std::string(buffer);
}

static void logDiagnosticV(const char* level, const char* source, const char* event, const char* fmt, va_list args) {
    std::fputs(("ts=" + isoTimestampUtc()).c_str(), stderr);
    std::fprintf(stderr, " level=%s source=%s event=%s", level, source, event);
    if (fmt && fmt[0] != '\0') {
        std::fputc(' ', stderr);
        std::vfprintf(stderr, fmt, args);
    }
    std::fputc('\n', stderr);
}

static void logDiagnostic(const char* level, const char* source, const char* event, const char* fmt = "", ...) {
    va_list args;
    va_start(args, fmt);
    logDiagnosticV(level, source, event, fmt, args);
    va_end(args);
}

extern std::unique_ptr<ArchiveBackend> createRarBackend();
extern std::unique_ptr<ArchiveBackend> createZipBackend();
extern std::unique_ptr<ArchiveBackend> createSevenZBackend();
extern std::unique_ptr<ArchiveBackend> createTarBackend();

static std::string getExtension(const std::string& filename) {
    auto pos = filename.rfind('.');
    if (pos == std::string::npos) return "";
    std::string ext = filename.substr(pos);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    return ext;
}

static volatile sig_atomic_t cancelled = 0;
static void signalHandler(int) { cancelled = 1; }

struct CliArgs {
    std::string input;
    std::string output;
    std::string backend = "rar";
    std::string readerFormat = "jpeg";
    int thumbWidth = 180;
    int thumbQuality = 60;
    int readerMaxDimension = 2400;
    int readerQuality = 82;
    int vipsConcurrency = 1;
    int windowBefore = 2;
    int windowAfter = 3;
};

static void printUsage(const char* prog) {
    fprintf(stderr,
        "Usage: %s --input FILE --output DIR --backend rar [options]\n"
        "\nReads focus commands from stdin as JSON-lines:\n"
        "  {\"type\":\"focus\",\"page\":50}\n"
        "  {\"type\":\"quit\"}\n", prog);
}

static bool parseArgs(int argc, char* argv[], CliArgs& args) {
    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--input" && i + 1 < argc) args.input = argv[++i];
        else if (arg == "--output" && i + 1 < argc) args.output = argv[++i];
        else if (arg == "--backend" && i + 1 < argc) args.backend = argv[++i];
        else if (arg == "--reader-format" && i + 1 < argc) args.readerFormat = argv[++i];
        else if (arg == "--thumb-width" && i + 1 < argc) args.thumbWidth = std::atoi(argv[++i]);
        else if (arg == "--thumb-quality" && i + 1 < argc) args.thumbQuality = std::atoi(argv[++i]);
        else if (arg == "--reader-max-dimension" && i + 1 < argc) args.readerMaxDimension = std::atoi(argv[++i]);
        else if (arg == "--reader-quality" && i + 1 < argc) args.readerQuality = std::atoi(argv[++i]);
        else if (arg == "--vips-concurrency" && i + 1 < argc) args.vipsConcurrency = std::atoi(argv[++i]);
        else if (arg == "--window-before" && i + 1 < argc) args.windowBefore = std::atoi(argv[++i]);
        else if (arg == "--window-after" && i + 1 < argc) args.windowAfter = std::atoi(argv[++i]);
        else if (arg == "--help" || arg == "-h") { printUsage(argv[0]); return false; }
        else { fprintf(stderr, "Unknown: %s\n", arg.c_str()); return false; }
    }
    if (args.input.empty() || args.output.empty()) {
        fprintf(stderr, "Error: --input and --output required\n");
        return false;
    }
    return true;
}

static std::string formatIndex(int index) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%06d", index);
    return buf;
}

static bool readStdinCommand(json& outCmd) {
#ifdef _WIN32
    return false;
#else
    struct pollfd pfd;
    pfd.fd = STDIN_FILENO;
    pfd.events = POLLIN;
    if (poll(&pfd, 1, 0) > 0 && (pfd.revents & POLLIN)) {
        std::string line;
        if (std::getline(std::cin, line) && !line.empty()) {
            try { outCmd = json::parse(line); return true; }
            catch (...) { logDiagnostic("warn", "worker", "bad_json", "line=%s", json(line).dump().c_str()); }
        }
    }
    return false;
#endif
}

static void emitReady(int pageIndex, const std::string& pageFile, const std::string& thumbFile, double ms) {
    json j;
    j["type"] = "ready";
    j["page"] = pageIndex;
    j["pageFile"] = pageFile;
    j["thumbFile"] = thumbFile;
    j["ms"] = ms;
    fprintf(stdout, "%s\n", j.dump().c_str());
    fflush(stdout);
}

// Callback for extraction progress
static void extractionProgress(int current, int total, const std::string& name, void* userData) {
    json j;
    j["type"] = "extracting";
    j["current"] = current;
    j["total"] = total;
    j["name"] = name;
    fprintf(stdout, "%s\n", j.dump().c_str());
    fflush(stdout);

    if (current % 50 == 0) {
        logDiagnostic("info", "worker", "extracting_progress", "current=%d name=%s", current + 1, json(name).dump().c_str());
    }
}

struct ProcMemorySnapshot {
    long vmRssKb = 0;
    long vmHwmKb = 0;
    long vmSizeKb = 0;
};

static double rssMb(const ProcMemorySnapshot& snapshot) {
    return snapshot.vmRssKb / 1024.0;
}

static ProcMemorySnapshot readProcMemorySnapshot() {
    ProcMemorySnapshot snapshot;
#ifndef _WIN32
    std::ifstream status("/proc/self/status");
    std::string line;
    while (std::getline(status, line)) {
        if (line.rfind("VmRSS:", 0) == 0) std::sscanf(line.c_str(), "VmRSS:%ld kB", &snapshot.vmRssKb);
        else if (line.rfind("VmHWM:", 0) == 0) std::sscanf(line.c_str(), "VmHWM:%ld kB", &snapshot.vmHwmKb);
        else if (line.rfind("VmSize:", 0) == 0) std::sscanf(line.c_str(), "VmSize:%ld kB", &snapshot.vmSizeKb);
    }
#endif
    return snapshot;
}

static void logWorkerMemory(const char* label) {
    ProcMemorySnapshot snapshot = readProcMemorySnapshot();
    const double trackedMemMb = vips_tracked_get_mem() / (1024.0 * 1024.0);
    const double trackedHighwaterMb = vips_tracked_get_mem_highwater() / (1024.0 * 1024.0);
    const int trackedAllocs = vips_tracked_get_allocs();
    const int cacheSize = vips_cache_get_size();
    logDiagnostic("info", "worker_mem", "snapshot",
        "label=%s rss=%.1fMB hwm=%.1fMB vms=%.1fMB "
        "vipsTracked=%.1fMB vipsHighwater=%.1fMB vipsAllocs=%d vipsCache=%d",
        label,
        snapshot.vmRssKb / 1024.0,
        snapshot.vmHwmKb / 1024.0,
        snapshot.vmSizeKb / 1024.0,
        trackedMemMb,
        trackedHighwaterMb,
        trackedAllocs,
        cacheSize);
}

static void logWorkerMemoryWithQueue(const char* label, const WorkQueue& queue, int processedCount) {
    ProcMemorySnapshot snapshot = readProcMemorySnapshot();
    const double trackedMemMb = vips_tracked_get_mem() / (1024.0 * 1024.0);
    const double trackedHighwaterMb = vips_tracked_get_mem_highwater() / (1024.0 * 1024.0);
    const int trackedAllocs = vips_tracked_get_allocs();
    const int cacheSize = vips_cache_get_size();
    logDiagnostic("info", "worker_mem", "snapshot",
        "label=%s rss=%.1fMB hwm=%.1fMB vms=%.1fMB processed=%d "
        "priorityPending=%d queueSize=%d bgNext=%d donePages=%d doneThumb=%d "
        "vipsTracked=%.1fMB vipsHighwater=%.1fMB vipsAllocs=%d vipsCache=%d",
        label,
        snapshot.vmRssKb / 1024.0,
        snapshot.vmHwmKb / 1024.0,
        snapshot.vmSizeKb / 1024.0,
        processedCount,
        queue.priorityRemaining(),
        queue.queuedItems(),
        queue.backgroundProgress(),
        queue.donePageCount(),
        queue.doneThumbOnlyCount(),
        trackedMemMb,
        trackedHighwaterMb,
        trackedAllocs,
        cacheSize);
}

static void logMemoryDeltaIfLarge(const char* eventName,
                                  int pageIndex,
                                  size_t entryBytes,
                                  const ProcMemorySnapshot& before,
                                  const ProcMemorySnapshot& after,
                                  const char* extraFmt = "",
                                  ...) {
    const double beforeMb = rssMb(before);
    const double afterMb = rssMb(after);
    const double deltaMb = afterMb - beforeMb;
    if (std::abs(deltaMb) < 32.0) {
        return;
    }

    char extraBuffer[512] = {0};
    if (extraFmt && extraFmt[0] != '\0') {
        va_list args;
        va_start(args, extraFmt);
        std::vsnprintf(extraBuffer, sizeof(extraBuffer), extraFmt, args);
        va_end(args);
    }

    logDiagnostic("info", "worker_mem", eventName,
        "page=%d entryBytes=%zu rssBefore=%.1fMB rssAfter=%.1fMB delta=%.1fMB%s%s",
        pageIndex,
        entryBytes,
        beforeMb,
        afterMb,
        deltaMb,
        extraBuffer[0] ? " " : "",
        extraBuffer);
}

int main(int argc, char* argv[]) {
    if (!std::setlocale(LC_CTYPE, "")) {
        std::setlocale(LC_CTYPE, "C.UTF-8");
    }

    CliArgs args;
    if (!parseArgs(argc, argv, args)) return 1;
    ArchiveCancelContext cancelContext{&cancelled};

    if (!fs::exists(args.input)) {
        logDiagnostic("error", "worker", "input_not_found", "input=%s", json(args.input).dump().c_str());
        return 1;
    }
    if (args.backend != "rar" && args.backend != "zip" && args.backend != "7z" && args.backend != "tar") {
        logDiagnostic("error", "worker", "unsupported_backend", "backend=%s", json(args.backend).dump().c_str());
        return 1;
    }
    if (args.readerFormat != "webp" && args.readerFormat != "jpeg") {
        logDiagnostic("error", "worker", "unsupported_reader_format", "readerFormat=%s", json(args.readerFormat).dump().c_str());
        return 1;
    }

    signal(SIGTERM, signalHandler);
    signal(SIGINT, signalHandler);

    if (VIPS_INIT(argv[0]) != 0) {
        logDiagnostic("error", "worker", "vips_init_failed");
        return 1;
    }
    if (args.vipsConcurrency > 0) {
        vips_concurrency_set(args.vipsConcurrency);
    }
    vips_cache_set_max(100);
    vips_cache_set_max_mem(64 * 1024 * 1024);
    vips_cache_set_max_files(20);

    // Clean and create output
    if (fs::exists(args.output)) fs::remove_all(args.output);
    fs::create_directories(args.output + "/thumbs");
    fs::create_directories(args.output + "/pages");
    fs::create_directories(args.output + "/raw");

    // Config
    ImageConfig config;
    config.thumbWidth = args.thumbWidth;
    config.thumbQuality = args.thumbQuality;
    config.readerMaxDimension = args.readerMaxDimension;
    config.readerQuality = args.readerQuality;
    config.readerFormat = args.readerFormat;

    // Manifest
    json manifestConfig;
    manifestConfig["thumbWidth"] = config.thumbWidth;
    manifestConfig["thumbQuality"] = config.thumbQuality;
    manifestConfig["readerMaxDimension"] = config.readerMaxDimension;
    manifestConfig["readerQuality"] = config.readerQuality;
    manifestConfig["readerFormat"] = config.readerFormat;
    manifestConfig["vipsConcurrency"] = args.vipsConcurrency;
    Manifest manifest(args.output, args.input, args.backend, manifestConfig);

    double totalDecodeMs = 0.0;
    double totalThumbMs = 0.0;
    double totalPageMs = 0.0;
    double totalOptimizedPageMs = 0.0;
    int optimizedPageCount = 0;
    double totalBackgroundThumbMs = 0.0;
    int backgroundThumbCount = 0;

    auto processPageAtIndex = [&](ArchiveBackend& activeBackend, int pageIndex) -> bool {
        std::vector<uint8_t> entryData;
        std::string entryName = activeBackend.entryName(pageIndex);
        if (entryName.empty()) return false;

        std::string idx = formatIndex(pageIndex);
        std::string ext = getExtension(entryName);
        std::string originalFile = ext.empty()
            ? ("raw/" + idx + ".bin")
            : ("raw/" + idx + ext);

        ProcMemorySnapshot beforeRead = readProcMemorySnapshot();
        if (!activeBackend.getEntry(pageIndex, entryData) || entryData.empty()) {
            std::string thumbFile = "thumbs/" + idx + ".jpg";
            std::string pageFile = "pages/" + idx + ".webp";
            generatePlaceholder(args.output + "/" + thumbFile, args.output + "/" + pageFile,
                config.thumbWidth, config.thumbQuality, config.readerQuality);
            manifest.addErrorPage(pageIndex, entryName, "Failed to read from raw", thumbFile, pageFile, originalFile);
            emitError(pageIndex, "Failed to read from raw");
            manifest.write();
            return false;
        }
        ProcMemorySnapshot afterRead = readProcMemorySnapshot();
        logMemoryDeltaIfLarge("entry_read_delta", pageIndex, entryData.size(), beforeRead, afterRead);

        auto pageStart = std::chrono::steady_clock::now();
        std::string thumbFile = "thumbs/" + idx + ".jpg";
        std::string optimizedExt = config.readerFormat == "jpeg" ? ".jpg" : ".webp";
        std::string pageFile = "pages/" + idx + optimizedExt;
        ProcMemorySnapshot beforeProcess = readProcMemorySnapshot();
        auto result = processImage(entryData, entryName, config,
            args.output + "/" + thumbFile, args.output + "/" + pageFile);
        ProcMemorySnapshot afterProcess = readProcMemorySnapshot();
        logMemoryDeltaIfLarge(
            "process_image_delta",
            pageIndex,
            entryData.size(),
            beforeProcess,
            afterProcess,
            "bypassed=%d thumbMs=%.1f pageMs=%.1f",
            result.bypassed ? 1 : 0,
            result.thumbMs,
            result.pageMs);
        entryData.clear();
        entryData.shrink_to_fit();
#ifndef _WIN32
        malloc_trim(0);  // Force glibc to return free pages to OS
#endif
        ProcMemorySnapshot afterRelease = readProcMemorySnapshot();
        logMemoryDeltaIfLarge("entry_release_delta", pageIndex, 0, afterProcess, afterRelease);
        auto pageEnd = std::chrono::steady_clock::now();
        double pageMs = std::chrono::duration<double, std::milli>(pageEnd - pageStart).count();

        // If bypassed, rename to original extension so MIME type is correct
        if (result.ok && result.bypassed) {
            std::string bypassPageFile = "pages/" + idx + ext;
            if (bypassPageFile != pageFile) {
                std::error_code ec;
                fs::rename(args.output + "/" + pageFile, args.output + "/" + bypassPageFile, ec);
                if (!ec) pageFile = bypassPageFile;
            }
        }

        if (!result.ok) {
            std::string errPageFile = "pages/" + idx + ".webp";
            generatePlaceholder(args.output + "/" + thumbFile, args.output + "/" + errPageFile,
                config.thumbWidth, config.thumbQuality, config.readerQuality);
            manifest.addErrorPage(pageIndex, entryName, result.errorMessage, thumbFile, errPageFile, originalFile);
            emitError(pageIndex, result.errorMessage);
            manifest.write();
            return false;
        }

        manifest.addPage(pageIndex, entryName, result, thumbFile, pageFile, originalFile);
        manifest.write();
        emitReady(pageIndex, pageFile, thumbFile, pageMs);
        totalDecodeMs += result.decodeMs;
        totalThumbMs += result.thumbMs;
        totalPageMs += result.pageMs;
        totalOptimizedPageMs += pageMs;
        optimizedPageCount++;
        if (pageMs >= kSlowPageLogThresholdMs) {
            const char* eventName = pageMs >= kVerySlowPageLogThresholdMs ? "very_slow_page" : "slow_page";
            logDiagnostic("info", "worker", eventName,
                "page=%d totalMs=%.1f decodeMs=%.1f thumbMs=%.1f pageMs=%.1f bypassed=%d entry=%s",
                pageIndex, pageMs, result.decodeMs, result.thumbMs, result.pageMs,
                result.bypassed ? 1 : 0, json(entryName).dump().c_str());
        }
        return true;
    };

    auto processPreviewFromRaw = [&](const std::string& entryName, const std::string& originalFile) -> bool {
        std::string idx = formatIndex(0);
        std::string ext = getExtension(entryName);
        std::string rawPath = args.output + "/" + originalFile;

        std::vector<uint8_t> entryData;
        if (!fs::exists(rawPath)) return false;
        const auto fileSize = fs::file_size(rawPath);
        entryData.resize(fileSize);
        std::ifstream in(rawPath, std::ios::binary);
        if (!in) return false;
        in.read(reinterpret_cast<char*>(entryData.data()), static_cast<std::streamsize>(fileSize));

        auto pageStart = std::chrono::steady_clock::now();
        std::string thumbFile = "thumbs/" + idx + ".jpg";
        std::string optimizedExt = config.readerFormat == "jpeg" ? ".jpg" : ".webp";
        std::string pageFile = "pages/" + idx + optimizedExt;
        auto result = processImage(entryData, entryName, config,
            args.output + "/" + thumbFile, args.output + "/" + pageFile);
        auto pageEnd = std::chrono::steady_clock::now();
        double pageMs = std::chrono::duration<double, std::milli>(pageEnd - pageStart).count();

        // If bypassed, rename to original extension so MIME type is correct
        if (result.ok && result.bypassed) {
            std::string bypassPageFile = "pages/" + idx + ext;
            if (bypassPageFile != pageFile) {
                std::error_code ec;
                fs::rename(args.output + "/" + pageFile, args.output + "/" + bypassPageFile, ec);
                if (!ec) pageFile = bypassPageFile;
            }
        }

        if (!result.ok) {
            std::string errPageFile = "pages/" + idx + ".webp";
            generatePlaceholder(args.output + "/" + thumbFile, args.output + "/" + errPageFile,
                config.thumbWidth, config.thumbQuality, config.readerQuality);
            manifest.addErrorPage(0, entryName, result.errorMessage, thumbFile, errPageFile, originalFile);
            emitError(0, result.errorMessage);
            manifest.write();
            return false;
        }

        manifest.addPage(0, entryName, result, thumbFile, pageFile, originalFile);
        manifest.write();
        emitReady(0, pageFile, thumbFile, pageMs);
        totalDecodeMs += result.decodeMs;
        totalThumbMs += result.thumbMs;
        totalPageMs += result.pageMs;
        totalOptimizedPageMs += pageMs;
        optimizedPageCount++;
        if (pageMs >= kSlowPageLogThresholdMs) {
            const char* eventName = pageMs >= kVerySlowPageLogThresholdMs ? "very_slow_preview_page" : "slow_preview_page";
            logDiagnostic("info", "worker", eventName,
                "page=0 totalMs=%.1f decodeMs=%.1f thumbMs=%.1f pageMs=%.1f bypassed=%d entry=%s",
                pageMs, result.decodeMs, result.thumbMs, result.pageMs,
                result.bypassed ? 1 : 0, json(entryName).dump().c_str());
        }
        return true;
    };

    auto totalStart = std::chrono::steady_clock::now();
    logWorkerMemory("startup");

    // === Phase 0: Fast preview for page 0 ===
    bool previewReady = false;
    bool previewProcessed = false;
    std::string previewEntryName;
    std::string previewRawPath;
    {
        std::unique_ptr<ArchiveBackend> previewBackend;
        if (args.backend == "rar") previewBackend = createRarBackend();
        else if (args.backend == "zip") previewBackend = createZipBackend();
        else if (args.backend == "7z") previewBackend = createSevenZBackend();
        else if (args.backend == "tar") previewBackend = createTarBackend();

        auto previewStart = std::chrono::steady_clock::now();
        try {
            previewReady = previewBackend->extractPreview(args.input, args.output + "/raw", 0, previewEntryName, previewRawPath);
        } catch (const std::exception& e) {
            logDiagnostic("error", "worker", "preview_extraction_failed", "message=%s", json(std::string(e.what())).dump().c_str());
            previewReady = false;
        }
        auto previewEnd = std::chrono::steady_clock::now();
        double previewMs = std::chrono::duration<double, std::milli>(previewEnd - previewStart).count();
        if (previewReady) {
            logDiagnostic("info", "worker", "preview_ready", "previewMs=%.1f entry=%s", previewMs, json(previewEntryName).dump().c_str());
            previewProcessed = processPreviewFromRaw(previewEntryName, previewRawPath);
            previewBackend->close();
        }
    }

    // === Phase 1: Extract all entries to raw/ (single sequential scan) ===
    std::unique_ptr<ArchiveBackend> backend;
    if (args.backend == "rar") backend = createRarBackend();
    else if (args.backend == "zip") backend = createZipBackend();
    else if (args.backend == "7z") backend = createSevenZBackend();
    else if (args.backend == "tar") backend = createTarBackend();
    int totalEntries;

    logDiagnostic("info", "worker", "phase_start", "phase=%s", json("extract_raw").dump().c_str());
    auto extractStart = std::chrono::steady_clock::now();

    try {
        totalEntries = backend->open(args.input, args.output + "/raw",
                                      extractionProgress, &cancelContext);
    } catch (const std::exception& e) {
        logDiagnostic("error", "worker", "archive_open_failed", "message=%s", json(std::string(e.what())).dump().c_str());
        vips_shutdown();
        return 1;
    }

    auto extractEnd = std::chrono::steady_clock::now();
    double extractMs = std::chrono::duration<double, std::milli>(extractEnd - extractStart).count();
    logDiagnostic("info", "worker", "phase_complete",
        "phase=%s totalEntries=%d totalMs=%.1f perEntryMs=%.1f",
        json("extract_raw").dump().c_str(), totalEntries, extractMs, totalEntries > 0 ? extractMs / totalEntries : 0);
    logWorkerMemory("after-extraction");

    if (totalEntries == 0) {
        json err;
        err["type"] = "error";
        err["message"] = "No image entries found in archive";
        fprintf(stdout, "%s\n", err.dump().c_str());
        fflush(stdout);
        logDiagnostic("error", "worker", "archive_empty", "input=%s", json(args.input).dump().c_str());
        vips_shutdown();
        return 1;
    }

    int processedCount = previewProcessed ? 1 : 0;

    // Work queue
    WorkQueue queue(totalEntries, args.output);
    if (processedCount > 0) {
        queue.markDone(0);
    }

    if (!cancelled) {
        // Emit archive info
        {
            json j;
            j["type"] = "archive";
            j["totalPages"] = totalEntries;
            j["extractionMs"] = extractMs;
            fprintf(stdout, "%s\n", j.dump().c_str());
            fflush(stdout);
        }

        // === Phase 2: Process pages on demand ===
        logDiagnostic("info", "worker", "phase_start", "phase=%s", json("focus_processing").dump().c_str());

        while (!cancelled) {
            // Check stdin
            json cmd;
            while (readStdinCommand(cmd)) {
                std::string type = cmd.value("type", "");
                if (type == "focus") {
                    int page = cmd.value("page", 0);
                    queue.focus(page, args.windowBefore, args.windowAfter);
                } else if (type == "quit") {
                    cancelled = 1;
                    break;
                }
            }
            if (cancelled) break;

            // Get next work item
            bool needsPage = false;
            int pageIndex = queue.next(needsPage);

            if (pageIndex < 0) {
#ifndef _WIN32
                struct pollfd pfd;
                pfd.fd = STDIN_FILENO;
                pfd.events = POLLIN;
                poll(&pfd, 1, 100);
#endif
                continue;
            }

            if (needsPage) {
                if (processPageAtIndex(*backend, pageIndex)) {
                    processedCount++;
                    if (processedCount % 25 == 0) {
                        char label[64];
                        std::snprintf(label, sizeof(label), "processed=%d", processedCount);
                        logWorkerMemoryWithQueue(label, queue, processedCount);
                    }
                }
                queue.markDone(pageIndex);
            } else if (pageIndex != 0 || processedCount == 0) {
                // Background: thumb only — with memory backpressure
                static constexpr long kBgThumbRssThresholdKb = 320L * 1024; // 320MB
                static int bgThumbPausedCount = 0;
                ProcMemorySnapshot memCheck = readProcMemorySnapshot();
                if (memCheck.vmRssKb > kBgThumbRssThresholdKb) {
                    bgThumbPausedCount++;
                    if (bgThumbPausedCount % 50 == 1) {
                        logDiagnostic("info", "worker", "bg_thumb_paused",
                            "rss=%.1fMB threshold=%.0fMB pauseCount=%d page=%d",
                            rssMb(memCheck), kBgThumbRssThresholdKb / 1024.0,
                            bgThumbPausedCount, pageIndex);
                    }
                    // Don't advance — let the allocator reclaim before next attempt
#ifndef _WIN32
                    struct pollfd pfd;
                    pfd.fd = STDIN_FILENO;
                    pfd.events = POLLIN;
                    poll(&pfd, 1, 50);  // Brief pause, still responsive to stdin
#endif
                    continue;
                }

                auto thumbStart = std::chrono::steady_clock::now();
                std::vector<uint8_t> entryData;
                std::string entryName = backend->entryName(pageIndex);
                std::string idx = formatIndex(pageIndex);
                std::string thumbFile = "thumbs/" + idx + ".jpg";

                ProcMemorySnapshot beforeRead = readProcMemorySnapshot();
                if (!backend->getEntry(pageIndex, entryData) || entryData.empty()) {
                    queue.markThumbOnly(pageIndex);
                    continue;
                }
                ProcMemorySnapshot afterRead = readProcMemorySnapshot();
                logMemoryDeltaIfLarge("bg_entry_read_delta", pageIndex, entryData.size(), beforeRead, afterRead);
                VipsImage* thumb = nullptr;
                ProcMemorySnapshot beforeThumb = readProcMemorySnapshot();
                if (vips_thumbnail_buffer(
                        const_cast<void*>(static_cast<const void*>(entryData.data())),
                        entryData.size(), &thumb, config.thumbWidth,
                        "height", config.thumbWidth * 3 / 2,
                        "size", VIPS_SIZE_DOWN, nullptr) == 0) {
                    vips_jpegsave(thumb, (args.output + "/" + thumbFile).c_str(),
                        "Q", config.thumbQuality, nullptr);
                    g_object_unref(thumb);
                }
                ProcMemorySnapshot afterThumb = readProcMemorySnapshot();
                logMemoryDeltaIfLarge("bg_thumb_delta", pageIndex, entryData.size(), beforeThumb, afterThumb);
                entryData.clear();
                entryData.shrink_to_fit();
#ifndef _WIN32
                malloc_trim(0);
#endif
                ProcMemorySnapshot afterRelease = readProcMemorySnapshot();
                logMemoryDeltaIfLarge("bg_entry_release_delta", pageIndex, 0, afterThumb, afterRelease);
                auto thumbEnd = std::chrono::steady_clock::now();
                totalBackgroundThumbMs += std::chrono::duration<double, std::milli>(thumbEnd - thumbStart).count();
                backgroundThumbCount++;
                emitProgress(pageIndex, totalEntries, "thumb", thumbFile);
                queue.markThumbOnly(pageIndex);
            }
        }
    }

    auto totalEnd = std::chrono::steady_clock::now();
    double totalMs = std::chrono::duration<double, std::milli>(totalEnd - totalStart).count();

    if (!cancelled) {
        manifest.finalize(processedCount);
        emitDone(processedCount, totalMs);
    }

    logDiagnostic("info", "worker", cancelled ? "cancelled" : "complete",
        "processedPages=%d totalMs=%.1f extractionMs=%.1f",
        processedCount, totalMs, extractMs);
    logDiagnostic("info", "worker", "timing_summary",
        "optimizedPages=%d optimizedTotalMs=%.1f optimizedAvgMs=%.1f "
        "decodeMs=%.1f thumbMs=%.1f pageMs=%.1f bgThumbCount=%d bgThumbTotalMs=%.1f bgThumbAvgMs=%.1f",
        optimizedPageCount,
        totalOptimizedPageMs,
        optimizedPageCount > 0 ? totalOptimizedPageMs / optimizedPageCount : 0.0,
        totalDecodeMs,
        totalThumbMs,
        totalPageMs,
        backgroundThumbCount,
        totalBackgroundThumbMs,
        backgroundThumbCount > 0 ? totalBackgroundThumbMs / backgroundThumbCount : 0.0);
    logWorkerMemoryWithQueue(cancelled ? "final-cancelled" : "final-complete", queue, processedCount);

    backend->close();
    vips_shutdown();
    return cancelled ? 1 : 0;
}
