#pragma once

#include <deque>
#include <set>
#include <string>
#include <vector>

/**
 * Priority work queue for the worker.
 *
 * Focus pages go to the front. Background (sequential thumbs) fills
 * from the back when no priority work is pending.
 * Pages already on disk are skipped automatically.
 */
class WorkQueue {
public:
    WorkQueue(int totalPages, const std::string& outputDir);

    /// Push a focus window to the front of the queue (pages + thumbs)
    void focus(int centerPage, int windowBefore, int windowAfter);

    /// Get next page to process. Returns -1 if nothing to do right now.
    /// Sets outNeedsPage to true if the reader page is needed (not just thumb).
    int next(bool& outNeedsPage);

    /// Mark a page as fully processed (both thumb and page)
    void markDone(int pageIndex);

    /// Mark a page as having thumb only (background processing)
    void markThumbOnly(int pageIndex);

    /// Check how many priority (focus) items remain
    int priorityRemaining() const;

    /// Get current background progress
    int backgroundProgress() const { return bgNext; }

    /// Current queue size for diagnostics
    int queuedItems() const { return static_cast<int>(priorityQueue.size()); }

    /// Completed optimized pages count
    int donePageCount() const { return static_cast<int>(donePages.size()); }

    /// Completed thumb-only pages count
    int doneThumbOnlyCount() const { return static_cast<int>(doneThumbOnly.size()); }

private:
    static constexpr int kFarJumpThreshold = 12;
    static constexpr int kMaxPriorityItems = 24;

    int totalPages;
    std::string outputDir;

    // Priority queue (focus pages, front = highest priority)
    std::deque<int> priorityQueue;

    // Track what's done
    std::set<int> donePages;    // pages with both thumb+page on disk
    std::set<int> doneThumbOnly; // pages with only thumb on disk

    // Background sequential thumb progress
    int bgNext = 0;
    int lastFocusPage = -1;
    int lastFocusStart = -1;
    int lastFocusEnd = -1;

    bool isPageDone(int pageIndex) const;
    bool isThumbDone(int pageIndex) const;
    bool thumbExistsOnDisk(int pageIndex) const;
    bool pageExistsOnDisk(int pageIndex) const;
    std::string formatIndex(int index) const;
    void trimPriorityQueue();
};
