#include "mupdf_renderer.h"
#include "image_pipeline.h"
#include "placeholder.h"
#include "manifest.h"
#include "progress.h"
#include "work_queue.h"

#include <vips/vips.h>
#include <nlohmann/json.hpp>

#include <chrono>
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
#include <malloc.h>
#endif

namespace fs = std::filesystem;
using json = nlohmann::json;

static constexpr double kSlowPageLogThresholdMs = 350.0;
static constexpr double kVerySlowPageLogThresholdMs = 700.0;

// ---- Logging (same format as archive worker) ----

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
    std::snprintf(buffer, sizeof(buffer),
        "%04d-%02d-%02dT%02d:%02d:%02d.%03lldZ",
        tmUtc.tm_year + 1900, tmUtc.tm_mon + 1, tmUtc.tm_mday,
        tmUtc.tm_hour, tmUtc.tm_min, tmUtc.tm_sec,
        static_cast<long long>(millis));
    return std::string(buffer);
}

static void logDiagnostic(const char* level, const char* source, const char* event, const char* fmt = "", ...) {
    std::fputs(("ts=" + isoTimestampUtc()).c_str(), stderr);
    std::fprintf(stderr, " level=%s source=%s event=%s", level, source, event);
    if (fmt && fmt[0] != '\0') {
        std::fputc(' ', stderr);
        va_list args;
        va_start(args, fmt);
        std::vfprintf(stderr, fmt, args);
        va_end(args);
    }
    std::fputc('\n', stderr);
}

// ---- Signal handling ----

static volatile sig_atomic_t cancelled = 0;
static void signalHandler(int) { cancelled = 1; }

// ---- CLI args ----

struct CliArgs {
    std::string input;
    std::string output;
    std::string readerFormat = "jpeg";
    int thumbWidth = 180;
    int thumbQuality = 60;
    int readerMaxDimension = 2400;
    int readerQuality = 82;
    int vipsConcurrency = 1;
    int windowBefore = 2;
    int windowAfter = 3;
};

static bool parseArgs(int argc, char* argv[], CliArgs& args) {
    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--input" && i + 1 < argc) args.input = argv[++i];
        else if (arg == "--output" && i + 1 < argc) args.output = argv[++i];
        else if (arg == "--reader-format" && i + 1 < argc) args.readerFormat = argv[++i];
        else if (arg == "--thumb-width" && i + 1 < argc) args.thumbWidth = std::atoi(argv[++i]);
        else if (arg == "--thumb-quality" && i + 1 < argc) args.thumbQuality = std::atoi(argv[++i]);
        else if (arg == "--reader-max-dimension" && i + 1 < argc) args.readerMaxDimension = std::atoi(argv[++i]);
        else if (arg == "--reader-quality" && i + 1 < argc) args.readerQuality = std::atoi(argv[++i]);
        else if (arg == "--vips-concurrency" && i + 1 < argc) args.vipsConcurrency = std::atoi(argv[++i]);
        else if (arg == "--window-before" && i + 1 < argc) args.windowBefore = std::atoi(argv[++i]);
        else if (arg == "--window-after" && i + 1 < argc) args.windowAfter = std::atoi(argv[++i]);
        else if (arg == "--help" || arg == "-h") { return false; }
        else { fprintf(stderr, "Unknown: %s\n", arg.c_str()); return false; }
    }
    if (args.input.empty() || args.output.empty()) {
        fprintf(stderr, "Error: --input and --output required\n");
        return false;
    }
    return true;
}

// ---- Memory diagnostics ----

struct ProcMemorySnapshot {
    long vmRssKb = 0;
    long vmHwmKb = 0;
    long vmSizeKb = 0;
};

static double rssMb(const ProcMemorySnapshot& s) { return s.vmRssKb / 1024.0; }

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
    ProcMemorySnapshot s = readProcMemorySnapshot();
    logDiagnostic("info", "worker_mem", "snapshot",
        "label=%s rss=%.1fMB hwm=%.1fMB vms=%.1fMB "
        "vipsTracked=%.1fMB vipsHighwater=%.1fMB vipsAllocs=%d vipsCache=%d",
        label, s.vmRssKb / 1024.0, s.vmHwmKb / 1024.0, s.vmSizeKb / 1024.0,
        vips_tracked_get_mem() / (1024.0 * 1024.0),
        vips_tracked_get_mem_highwater() / (1024.0 * 1024.0),
        vips_tracked_get_allocs(), vips_cache_get_size());
}

static void logWorkerMemoryWithQueue(const char* label, const WorkQueue& queue, int processedCount) {
    ProcMemorySnapshot s = readProcMemorySnapshot();
    logDiagnostic("info", "worker_mem", "snapshot",
        "label=%s rss=%.1fMB hwm=%.1fMB vms=%.1fMB processed=%d "
        "priorityPending=%d queueSize=%d bgNext=%d donePages=%d doneThumb=%d "
        "vipsTracked=%.1fMB vipsHighwater=%.1fMB vipsAllocs=%d vipsCache=%d",
        label, s.vmRssKb / 1024.0, s.vmHwmKb / 1024.0, s.vmSizeKb / 1024.0,
        processedCount,
        queue.priorityRemaining(), queue.queuedItems(), queue.backgroundProgress(),
        queue.donePageCount(), queue.doneThumbOnlyCount(),
        vips_tracked_get_mem() / (1024.0 * 1024.0),
        vips_tracked_get_mem_highwater() / (1024.0 * 1024.0),
        vips_tracked_get_allocs(), vips_cache_get_size());
}

static void logMemoryDeltaIfLarge(const char* eventName, int pageIndex, size_t entryBytes,
                                  const ProcMemorySnapshot& before, const ProcMemorySnapshot& after) {
    double deltaMb = rssMb(after) - rssMb(before);
    if (std::abs(deltaMb) < 32.0) return;
    logDiagnostic("info", "worker_mem", eventName,
        "page=%d entryBytes=%zu rssBefore=%.1fMB rssAfter=%.1fMB delta=%.1fMB",
        pageIndex, entryBytes, rssMb(before), rssMb(after), deltaMb);
}

// ---- stdin commands ----

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
            catch (...) {}
        }
    }
    return false;
#endif
}

// ---- stdout events ----

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

// ---- helpers ----

static std::string formatIndex(int index) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%06d", index);
    return buf;
}

static double nowMs() {
    return std::chrono::duration<double, std::milli>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

// ---- Process a single page: rasterize → thumb + reader page via vips ----

static bool processDocPage(MuPdfRenderer& renderer, int pageIndex,
                           const ImageConfig& config, const std::string& outputDir,
                           Manifest& manifest, double& totalRenderMs, double& totalThumbMs,
                           double& totalPageMs, int& optimizedCount) {
    std::string idx = formatIndex(pageIndex);
    std::string thumbFile = "thumbs/" + idx + ".jpg";
    std::string optimizedExt = config.readerFormat == "jpeg" ? ".jpg" : ".webp";
    std::string pageFile = "pages/" + idx + optimizedExt;
    std::string pageName = "page-" + std::to_string(pageIndex + 1);

    auto pageStart = std::chrono::steady_clock::now();

    // Rasterize with MuPDF
    std::vector<uint8_t> rgbData;
    int pixW = 0, pixH = 0;

    ProcMemorySnapshot beforeRender = readProcMemorySnapshot();
    bool rendered = renderer.renderPage(pageIndex, config.readerMaxDimension, rgbData, pixW, pixH);
    ProcMemorySnapshot afterRender = readProcMemorySnapshot();
    logMemoryDeltaIfLarge("render_delta", pageIndex, rgbData.size(), beforeRender, afterRender);

    if (!rendered || rgbData.empty()) {
        generatePlaceholder(outputDir + "/" + thumbFile, outputDir + "/" + pageFile,
            config.thumbWidth, config.thumbQuality, config.readerQuality);
        manifest.addErrorPage(pageIndex, pageName, "Failed to render page", thumbFile, pageFile, "");
        emitError(pageIndex, "Failed to render page");
        manifest.write();
        return false;
    }

    // Convert RGB pixels to JPEG/WebP via vips
    double t1 = nowMs();

    // Create VipsImage from raw RGB buffer
    VipsImage* image = vips_image_new_from_memory(
        rgbData.data(), rgbData.size(), pixW, pixH, 3, VIPS_FORMAT_UCHAR);
    if (!image) {
        generatePlaceholder(outputDir + "/" + thumbFile, outputDir + "/" + pageFile,
            config.thumbWidth, config.thumbQuality, config.readerQuality);
        manifest.addErrorPage(pageIndex, pageName, "Failed to create vips image", thumbFile, pageFile, "");
        emitError(pageIndex, "Failed to create vips image from render");
        manifest.write();
        return false;
    }

    // Thumbnail
    VipsImage* thumb = nullptr;
    double thumbMs = 0;
    if (vips_thumbnail_image(image, &thumb, config.thumbWidth,
            "height", config.thumbWidth * 3 / 2,
            "size", VIPS_SIZE_DOWN, nullptr) == 0) {
        vips_jpegsave(thumb, (outputDir + "/" + thumbFile).c_str(),
            "Q", config.thumbQuality, nullptr);
        g_object_unref(thumb);
    }
    thumbMs = nowMs() - t1;

    // Reader page (save full rendered image)
    double t2 = nowMs();
    int saveStatus = 0;
    if (config.readerFormat == "jpeg") {
        saveStatus = vips_jpegsave(image, (outputDir + "/" + pageFile).c_str(),
            "Q", config.readerQuality, "strip", TRUE, nullptr);
    } else {
        saveStatus = vips_webpsave(image, (outputDir + "/" + pageFile).c_str(),
            "Q", config.readerQuality, "effort", 1, "strip", TRUE, nullptr);
    }
    double pageMs = nowMs() - t2;

    g_object_unref(image);
    image = nullptr;

    // Free RGB buffer
    rgbData.clear();
    rgbData.shrink_to_fit();
#ifndef _WIN32
    malloc_trim(0);
#endif

    ProcMemorySnapshot afterRelease = readProcMemorySnapshot();
    logMemoryDeltaIfLarge("page_release_delta", pageIndex, 0, afterRender, afterRelease);

    auto pageEnd = std::chrono::steady_clock::now();
    double totalMs = std::chrono::duration<double, std::milli>(pageEnd - pageStart).count();

    if (saveStatus != 0) {
        generatePlaceholder(outputDir + "/" + thumbFile, outputDir + "/" + pageFile,
            config.thumbWidth, config.thumbQuality, config.readerQuality);
        manifest.addErrorPage(pageIndex, pageName, "Failed to save page", thumbFile, pageFile, "");
        emitError(pageIndex, "Failed to save rendered page");
        manifest.write();
        return false;
    }

    // Build ImageResult for manifest
    ImageResult result;
    result.ok = true;
    result.originalWidth = pixW;
    result.originalHeight = pixH;
    result.pageWidth = pixW;
    result.pageHeight = pixH;
    result.bypassed = false;
    result.decodeMs = 0;  // no "decode" for documents
    result.thumbMs = thumbMs;
    result.pageMs = pageMs;

    manifest.addPage(pageIndex, pageName, result, thumbFile, pageFile, "");
    manifest.write();
    emitReady(pageIndex, pageFile, thumbFile, totalMs);

    totalRenderMs += (thumbMs + pageMs);
    totalThumbMs += thumbMs;
    totalPageMs += pageMs;
    optimizedCount++;

    if (totalMs >= kSlowPageLogThresholdMs) {
        const char* evt = totalMs >= kVerySlowPageLogThresholdMs ? "very_slow_page" : "slow_page";
        logDiagnostic("info", "worker", evt,
            "page=%d totalMs=%.1f thumbMs=%.1f pageMs=%.1f pixW=%d pixH=%d",
            pageIndex, totalMs, thumbMs, pageMs, pixW, pixH);
    }

    return true;
}

// ==== MAIN ====

int main(int argc, char* argv[]) {
    CliArgs args;
    if (!parseArgs(argc, argv, args)) return 1;

    if (!fs::exists(args.input)) {
        logDiagnostic("error", "worker", "input_not_found", "input=%s", json(args.input).dump().c_str());
        return 1;
    }

    signal(SIGTERM, signalHandler);
    signal(SIGINT, signalHandler);

    if (VIPS_INIT(argv[0]) != 0) {
        logDiagnostic("error", "worker", "vips_init_failed");
        return 1;
    }
    if (args.vipsConcurrency > 0) vips_concurrency_set(args.vipsConcurrency);
    vips_cache_set_max(100);
    vips_cache_set_max_mem(64 * 1024 * 1024);
    vips_cache_set_max_files(20);

    // Create output directories
    if (fs::exists(args.output)) fs::remove_all(args.output);
    fs::create_directories(args.output + "/thumbs");
    fs::create_directories(args.output + "/pages");

    ImageConfig config;
    config.thumbWidth = args.thumbWidth;
    config.thumbQuality = args.thumbQuality;
    config.readerMaxDimension = args.readerMaxDimension;
    config.readerQuality = args.readerQuality;
    config.readerFormat = args.readerFormat;

    auto totalStart = std::chrono::steady_clock::now();
    logWorkerMemory("startup");

    // Open document with MuPDF
    MuPdfRenderer renderer;
    if (!renderer.open(args.input)) {
        logDiagnostic("error", "worker", "document_open_failed", "input=%s", json(args.input).dump().c_str());
        vips_shutdown();
        return 1;
    }

    int totalPages = renderer.pageCount();
    logDiagnostic("info", "worker", "document_opened", "totalPages=%d", totalPages);

    // Manifest
    json manifestConfig;
    manifestConfig["thumbWidth"] = config.thumbWidth;
    manifestConfig["thumbQuality"] = config.thumbQuality;
    manifestConfig["readerMaxDimension"] = config.readerMaxDimension;
    manifestConfig["readerQuality"] = config.readerQuality;
    manifestConfig["readerFormat"] = config.readerFormat;
    manifestConfig["vipsConcurrency"] = args.vipsConcurrency;
    Manifest manifest(args.output, args.input, "mupdf", manifestConfig);

    double totalRenderMs = 0, totalThumbMs = 0, totalPageMs = 0;
    double totalBgThumbMs = 0;
    int optimizedCount = 0, bgThumbCount = 0;
    int processedCount = 0;

    // === Phase 0: Fast preview (page 0) ===
    if (!cancelled && totalPages > 0) {
        logDiagnostic("info", "worker", "phase_start", "phase=\"preview\"");
        processDocPage(renderer, 0, config, args.output, manifest,
                       totalRenderMs, totalThumbMs, totalPageMs, optimizedCount);
        processedCount = 1;
    }

    // === Phase 1: Emit archive info (instant — just page count) ===
    if (!cancelled) {
        json j;
        j["type"] = "archive";
        j["totalPages"] = totalPages;
        j["extractionMs"] = 0;  // no extraction for documents
        fprintf(stdout, "%s\n", j.dump().c_str());
        fflush(stdout);
    }

    // Work queue
    WorkQueue queue(totalPages, args.output);
    if (processedCount > 0) queue.markDone(0);

    logWorkerMemory("after-open");

    // === Phase 2: On-demand processing with focus window ===
    if (!cancelled) {
        logDiagnostic("info", "worker", "phase_start", "phase=\"focus_processing\"");

        while (!cancelled) {
            // Poll stdin for commands
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
                // Foreground: full page + thumb
                if (processDocPage(renderer, pageIndex, config, args.output, manifest,
                                   totalRenderMs, totalThumbMs, totalPageMs, optimizedCount)) {
                    processedCount++;
                    if (processedCount % 25 == 0) {
                        char label[64];
                        std::snprintf(label, sizeof(label), "processed=%d", processedCount);
                        logWorkerMemoryWithQueue(label, queue, processedCount);
                    }
                }
                queue.markDone(pageIndex);
            } else {
                // Background: thumb only — with memory backpressure
                static constexpr long kBgThumbRssThresholdKb = 320L * 1024;
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
#ifndef _WIN32
                    struct pollfd pfd;
                    pfd.fd = STDIN_FILENO;
                    pfd.events = POLLIN;
                    poll(&pfd, 1, 50);
#endif
                    continue;
                }

                auto thumbStart = std::chrono::steady_clock::now();
                std::string idx = formatIndex(pageIndex);
                std::string thumbFile = "thumbs/" + idx + ".jpg";

                // Rasterize at low resolution for thumbnail
                std::vector<uint8_t> rgbData;
                int pixW = 0, pixH = 0;
                // Use thumbWidth * 2 as maxDim for decent quality thumbnail source
                if (renderer.renderPage(pageIndex, config.thumbWidth * 2, rgbData, pixW, pixH)
                    && !rgbData.empty()) {
                    VipsImage* image = vips_image_new_from_memory(
                        rgbData.data(), rgbData.size(), pixW, pixH, 3, VIPS_FORMAT_UCHAR);
                    if (image) {
                        VipsImage* thumb = nullptr;
                        if (vips_thumbnail_image(image, &thumb, config.thumbWidth,
                                "height", config.thumbWidth * 3 / 2,
                                "size", VIPS_SIZE_DOWN, nullptr) == 0) {
                            vips_jpegsave(thumb, (args.output + "/" + thumbFile).c_str(),
                                "Q", config.thumbQuality, nullptr);
                            g_object_unref(thumb);
                        }
                        g_object_unref(image);
                    }
                }
                rgbData.clear();
                rgbData.shrink_to_fit();
#ifndef _WIN32
                malloc_trim(0);
#endif
                auto thumbEnd = std::chrono::steady_clock::now();
                totalBgThumbMs += std::chrono::duration<double, std::milli>(thumbEnd - thumbStart).count();
                bgThumbCount++;
                emitProgress(pageIndex, totalPages, "thumb", thumbFile);
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
        "processedPages=%d totalMs=%.1f", processedCount, totalMs);
    logDiagnostic("info", "worker", "timing_summary",
        "optimizedPages=%d renderMs=%.1f thumbMs=%.1f pageMs=%.1f "
        "bgThumbCount=%d bgThumbTotalMs=%.1f bgThumbAvgMs=%.1f",
        optimizedCount, totalRenderMs, totalThumbMs, totalPageMs,
        bgThumbCount, totalBgThumbMs,
        bgThumbCount > 0 ? totalBgThumbMs / bgThumbCount : 0.0);
    logWorkerMemoryWithQueue(cancelled ? "final-cancelled" : "final-complete", queue, processedCount);

    renderer.close();
    vips_shutdown();
    return cancelled ? 1 : 0;
}
