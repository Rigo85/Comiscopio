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
    fprintf(stderr, "[queue] focus(%d) window %d-%d, qBefore: %d, donePages: %d, doneThumb: %d\n",
        centerPage, start, end, (int)priorityQueue.size(),
        (int)donePages.size(), (int)doneThumbOnly.size());

    // Remove these pages from wherever they are in the priority queue
    std::set<int> windowSet;
    for (int i = start; i <= end; i++) {
        windowSet.insert(i);
    }

    // Remove existing entries that are in the new window
    priorityQueue.erase(
        std::remove_if(priorityQueue.begin(), priorityQueue.end(),
            [&windowSet](int p) { return windowSet.count(p) > 0; }),
        priorityQueue.end()
    );

    // Insert window at the front, center page first
    std::deque<int> newFront;
    newFront.push_back(centerPage);
    for (int i = start; i <= end; i++) {
        if (i != centerPage) {
            newFront.push_back(i);
        }
    }

    // Prepend to priority queue
    for (auto it = newFront.rbegin(); it != newFront.rend(); ++it) {
        priorityQueue.push_front(*it);
    }

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
