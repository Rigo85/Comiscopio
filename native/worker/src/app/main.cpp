#include "archive_backend.h"
#include "image_pipeline.h"
#include "placeholder.h"
#include "manifest.h"
#include "progress.h"
#include "work_queue.h"

#include <vips/vips.h>
#include <nlohmann/json.hpp>

#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <memory>
#include <string>

#ifndef _WIN32
#include <poll.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;
using json = nlohmann::json;

extern std::unique_ptr<ArchiveBackend> createRarBackend();

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
    int thumbWidth = 180;
    int thumbQuality = 60;
    int readerMaxDimension = 2400;
    int readerQuality = 82;
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
        else if (arg == "--thumb-width" && i + 1 < argc) args.thumbWidth = std::atoi(argv[++i]);
        else if (arg == "--thumb-quality" && i + 1 < argc) args.thumbQuality = std::atoi(argv[++i]);
        else if (arg == "--reader-max-dimension" && i + 1 < argc) args.readerMaxDimension = std::atoi(argv[++i]);
        else if (arg == "--reader-quality" && i + 1 < argc) args.readerQuality = std::atoi(argv[++i]);
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
            catch (...) { fprintf(stderr, "[worker] Bad JSON: %s\n", line.c_str()); }
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

    if (current % 50 == 0 || current == total - 1) {
        fprintf(stderr, "[worker] Extracting %d/%d: %s\n", current + 1, total, name.c_str());
    }
}

int main(int argc, char* argv[]) {
    CliArgs args;
    if (!parseArgs(argc, argv, args)) return 1;

    if (!fs::exists(args.input)) {
        fprintf(stderr, "Error: input not found: %s\n", args.input.c_str());
        return 1;
    }
    if (args.backend != "rar") {
        fprintf(stderr, "Error: unsupported backend '%s'\n", args.backend.c_str());
        return 1;
    }

    signal(SIGTERM, signalHandler);
    signal(SIGINT, signalHandler);

    if (VIPS_INIT(argv[0]) != 0) {
        fprintf(stderr, "Error: vips init failed\n");
        return 1;
    }

    // Clean and create output
    if (fs::exists(args.output)) fs::remove_all(args.output);
    fs::create_directories(args.output + "/thumbs");
    fs::create_directories(args.output + "/pages");
    fs::create_directories(args.output + "/raw");

    auto totalStart = std::chrono::steady_clock::now();

    // === Phase 1: Extract all entries to raw/ (single sequential scan) ===
    auto backend = createRarBackend();
    int totalEntries;

    fprintf(stderr, "[worker] Phase 1: Extracting archive to raw/...\n");
    auto extractStart = std::chrono::steady_clock::now();

    try {
        totalEntries = backend->open(args.input, args.output + "/raw",
                                      extractionProgress, nullptr);
    } catch (const std::exception& e) {
        fprintf(stderr, "Error: %s\n", e.what());
        vips_shutdown();
        return 1;
    }

    auto extractEnd = std::chrono::steady_clock::now();
    double extractMs = std::chrono::duration<double, std::milli>(extractEnd - extractStart).count();
    fprintf(stderr, "[worker] Phase 1 complete: %d entries in %.1fms (%.1fms/entry)\n",
        totalEntries, extractMs, totalEntries > 0 ? extractMs / totalEntries : 0);

    // Emit archive info
    {
        json j;
        j["type"] = "archive";
        j["totalPages"] = totalEntries;
        j["extractionMs"] = extractMs;
        fprintf(stdout, "%s\n", j.dump().c_str());
        fflush(stdout);
    }

    // Config
    ImageConfig config;
    config.thumbWidth = args.thumbWidth;
    config.thumbQuality = args.thumbQuality;
    config.readerMaxDimension = args.readerMaxDimension;
    config.readerQuality = args.readerQuality;

    // Manifest
    json manifestConfig;
    manifestConfig["thumbWidth"] = config.thumbWidth;
    manifestConfig["thumbQuality"] = config.thumbQuality;
    manifestConfig["readerMaxDimension"] = config.readerMaxDimension;
    manifestConfig["readerQuality"] = config.readerQuality;
    Manifest manifest(args.output, args.input, args.backend, manifestConfig);

    // Work queue
    WorkQueue queue(totalEntries, args.output);

    // === Phase 2: Process pages on demand ===
    fprintf(stderr, "[worker] Phase 2: Ready for focus commands\n");

    int processedCount = 0;

    while (!cancelled) {
        // Check stdin
        json cmd;
        while (readStdinCommand(cmd)) {
            std::string type = cmd.value("type", "");
            if (type == "focus") {
                int page = cmd.value("page", 0);
                queue.focus(page, args.windowBefore, args.windowAfter);
                fprintf(stderr, "[worker] Focus -> page %d\n", page);
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
            if (queue.backgroundProgress() >= totalEntries && queue.priorityRemaining() == 0)
                break;
            continue;
        }

        auto pageStart = std::chrono::steady_clock::now();

        // Read from raw/ (instant disk access)
        std::vector<uint8_t> entryData;
        std::string entryName = backend->entryName(pageIndex);

        if (!backend->getEntry(pageIndex, entryData) || entryData.empty()) {
            // Entry failed during extraction
            std::string idx = formatIndex(pageIndex);
            std::string thumbFile = "thumbs/" + idx + ".jpg";
            std::string pageFile = "pages/" + idx + ".webp";
            generatePlaceholder(args.output + "/" + thumbFile, args.output + "/" + pageFile,
                config.thumbWidth, config.thumbQuality, config.readerQuality);
            manifest.addErrorPage(pageIndex, entryName, "Failed to read from raw", thumbFile, pageFile);
            emitError(pageIndex, "Failed to read from raw");
            queue.markDone(pageIndex);
            processedCount++;
            continue;
        }

        std::string idx = formatIndex(pageIndex);
        std::string thumbFile = "thumbs/" + idx + ".jpg";

        if (needsPage) {
            // Full: thumb + page
            int maxDim = 0;
            {
                VipsImage* probe = vips_image_new_from_buffer(entryData.data(), entryData.size(), "", nullptr);
                if (probe) {
                    maxDim = std::max(vips_image_get_width(probe), vips_image_get_height(probe));
                    g_object_unref(probe);
                }
            }

            bool willBypass = (maxDim > 0 && maxDim <= config.readerMaxDimension);
            std::string ext = getExtension(entryName);
            std::string pageFile = willBypass ? ("pages/" + idx + ext) : ("pages/" + idx + ".webp");

            auto result = processImage(entryData, entryName, config,
                args.output + "/" + thumbFile, args.output + "/" + pageFile);

            auto pageEnd = std::chrono::steady_clock::now();
            double pageMs = std::chrono::duration<double, std::milli>(pageEnd - pageStart).count();

            if (!result.ok) {
                std::string errPageFile = "pages/" + idx + ".webp";
                generatePlaceholder(args.output + "/" + thumbFile, args.output + "/" + errPageFile,
                    config.thumbWidth, config.thumbQuality, config.readerQuality);
                manifest.addErrorPage(pageIndex, entryName, result.errorMessage, thumbFile, errPageFile);
                emitError(pageIndex, result.errorMessage);
            } else {
                manifest.addPage(pageIndex, entryName, result, thumbFile, pageFile);
                emitReady(pageIndex, pageFile, thumbFile, pageMs);
                fprintf(stderr, "[worker] page %d: %.1fms (decode=%.1f thumb=%.1f page=%.1f) %s%s\n",
                    pageIndex, pageMs, result.decodeMs, result.thumbMs, result.pageMs,
                    result.bypassed ? "BYPASS " : "", entryName.c_str());
            }
            queue.markDone(pageIndex);
        } else {
            // Background: thumb only
            VipsImage* thumb = nullptr;
            if (vips_thumbnail_buffer(
                    const_cast<void*>(static_cast<const void*>(entryData.data())),
                    entryData.size(), &thumb, config.thumbWidth,
                    "height", config.thumbWidth * 3 / 2,
                    "size", VIPS_SIZE_DOWN, nullptr) == 0) {
                vips_jpegsave(thumb, (args.output + "/" + thumbFile).c_str(),
                    "Q", config.thumbQuality, nullptr);
                g_object_unref(thumb);
            }
            emitProgress(pageIndex, totalEntries, "thumb", thumbFile);
            queue.markThumbOnly(pageIndex);
        }

        manifest.write();
        processedCount++;
        entryData.clear();
        entryData.shrink_to_fit();
    }

    auto totalEnd = std::chrono::steady_clock::now();
    double totalMs = std::chrono::duration<double, std::milli>(totalEnd - totalStart).count();

    if (!cancelled) {
        manifest.finalize(processedCount);
        emitDone(processedCount, totalMs);
    }

    fprintf(stderr, "[worker] %s: %d pages processed in %.1fms (extraction: %.1fms)\n",
        cancelled ? "Cancelled" : "Complete", processedCount, totalMs, extractMs);

    backend->close();
    vips_shutdown();
    return cancelled ? 1 : 0;
}

