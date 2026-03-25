#include "work_queue.h"
#include <algorithm>
#include <filesystem>
#include <cstdio>

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
        fprintf(stderr, "[queue] focus(%d) ignored (same window %d-%d)\n", centerPage, start, end);
        return;
    }

    fprintf(stderr, "[queue] focus(%d) window %d-%d, qBefore: %d, donePages: %d, doneThumb: %d\n",
        centerPage, start, end, (int)priorityQueue.size(),
        (int)donePages.size(), (int)doneThumbOnly.size());

    if (lastFocusPage >= 0 && std::abs(centerPage - lastFocusPage) > kFarJumpThreshold) {
        priorityQueue.clear();
        fprintf(stderr, "[queue] pruned stale priority queue on far jump %d -> %d\n", lastFocusPage, centerPage);
    }

    const bool hadPreviousWindow = lastFocusStart >= 0 && lastFocusEnd >= 0;
    const bool overlapsPreviousWindow =
        hadPreviousWindow && !(end < lastFocusStart || start > lastFocusEnd);

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

    if (overlapsPreviousWindow && centerPage != lastFocusPage) {
        fprintf(stderr,
            "[queue] merged nearby focus into active window %d-%d -> %d-%d\n",
            lastFocusStart, lastFocusEnd, start, end);
    }

    trimPriorityQueue();
    lastFocusPage = centerPage;
    lastFocusStart = start;
    lastFocusEnd = end;

    fprintf(stderr, "[queue] after focus(%d): qSize=%d, front=%d\n",
        centerPage, (int)priorityQueue.size(),
        priorityQueue.empty() ? -1 : priorityQueue.front());
}

int WorkQueue::next(bool& outNeedsPage) {
    // First: try priority queue
    while (!priorityQueue.empty()) {
        int page = priorityQueue.front();
        priorityQueue.pop_front();

        if (isPageDone(page)) {
            fprintf(stderr, "[queue] skip priority %d (already done)\n", page);
            continue;
        }

        outNeedsPage = true;
        fprintf(stderr, "[queue] priority -> page %d (remaining: %d)\n", page, (int)priorityQueue.size());
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
