#include "work_queue.h"
#include <algorithm>
#include <chrono>
#include <ctime>
#include <filesystem>
#include <cstdio>

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

namespace fs = std::filesystem;

WorkQueue::WorkQueue(int totalPages, const std::string& outputDir)
    : totalPages(totalPages), outputDir(outputDir) {
    // Scan disk for already-processed pages
    for (int i = 0; i < totalPages; i++) {
        bool hasThumb = thumbExistsOnDisk(i);
        bool hasPage = pageExistsOnDisk(i);
        if (hasThumb && hasPage) {
            donePages.insert(i);
        } else if (hasThumb) {
            doneThumbOnly.insert(i);
        }
    }
}

void WorkQueue::focus(int centerPage, int windowBefore, int windowAfter) {
    int start = std::max(0, centerPage - windowBefore);
    int end = std::min(totalPages - 1, centerPage + windowAfter);

    if (centerPage == lastFocusPage && start == lastFocusStart && end == lastFocusEnd) {
        return;
    }

    if (lastFocusPage >= 0 && std::abs(centerPage - lastFocusPage) > kFarJumpThreshold) {
        priorityQueue.clear();
        std::fprintf(
            stderr,
            "ts=%s level=info source=queue event=pruned_stale_priority oldPage=%d newPage=%d\n",
            isoTimestampUtc().c_str(),
            lastFocusPage,
            centerPage);
    }

    // Build the active priority window as center first, then nearest neighbors.
    // For nearby navigation we replace the active window instead of accumulating
    // overlapping windows, which keeps the queue small during sequential moves.
    std::deque<int> newFront;
    newFront.push_back(centerPage);

    for (int distance = 1; distance <= std::max(centerPage - start, end - centerPage); distance++) {
        int right = centerPage + distance;
        if (right <= end) {
            newFront.push_back(right);
        }

        int left = centerPage - distance;
        if (left >= start) {
            newFront.push_back(left);
        }
    }

    priorityQueue.clear();
    for (int page : newFront) {
        priorityQueue.push_back(page);
    }

    trimPriorityQueue();
    lastFocusPage = centerPage;
    lastFocusStart = start;
    lastFocusEnd = end;
}

int WorkQueue::next(bool& outNeedsPage) {
    // First: try priority queue
    while (!priorityQueue.empty()) {
        int page = priorityQueue.front();
        priorityQueue.pop_front();

        if (isPageDone(page)) {
            continue;
        }

        outNeedsPage = true;
        return page;
    }

    // If we get here with an empty priority queue but there were focus calls, log it
    if (priorityQueue.empty() && donePages.size() > 0) {
        // This should not happen often after focus calls
    }

    // Second: background sequential thumbs
    while (bgNext < totalPages) {
        int page = bgNext++;
        if (donePages.count(page) || doneThumbOnly.count(page)) continue;

        outNeedsPage = false; // background only needs thumb
        return page;
    }

    return -1; // nothing to do
}

void WorkQueue::markDone(int pageIndex) {
    donePages.insert(pageIndex);
    doneThumbOnly.erase(pageIndex);
}

void WorkQueue::markThumbOnly(int pageIndex) {
    if (donePages.count(pageIndex) == 0) {
        doneThumbOnly.insert(pageIndex);
    }
}

int WorkQueue::priorityRemaining() const {
    int count = 0;
    for (int p : priorityQueue) {
        if (!isPageDone(p)) count++;
    }
    return count;
}

bool WorkQueue::isPageDone(int pageIndex) const {
    return donePages.count(pageIndex) > 0;
}

bool WorkQueue::isThumbDone(int pageIndex) const {
    return donePages.count(pageIndex) > 0 || doneThumbOnly.count(pageIndex) > 0;
}

bool WorkQueue::thumbExistsOnDisk(int pageIndex) const {
    std::string path = outputDir + "/thumbs/" + formatIndex(pageIndex) + ".jpg";
    return fs::exists(path);
}

bool WorkQueue::pageExistsOnDisk(int pageIndex) const {
    std::string prefix = outputDir + "/pages/" + formatIndex(pageIndex);
    // Check common extensions
    for (const char* ext : {".webp", ".jpg", ".jpeg", ".png"}) {
        if (fs::exists(prefix + ext)) return true;
    }
    return false;
}

std::string WorkQueue::formatIndex(int index) const {
    char buf[16];
    snprintf(buf, sizeof(buf), "%06d", index);
    return buf;
}

void WorkQueue::trimPriorityQueue() {
    std::set<int> seen;
    std::deque<int> trimmed;

    for (int page : priorityQueue) {
        if (seen.count(page) > 0) continue;
        seen.insert(page);
        trimmed.push_back(page);
        if ((int)trimmed.size() >= kMaxPriorityItems) break;
    }

    priorityQueue = std::move(trimmed);
}
