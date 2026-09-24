#include "work_queue.h"
#include <stdexcept>

static void check(bool ok) { if (!ok) throw std::runtime_error("work queue regression"); }
int main() {
    WorkQueue queue(4, "nonexistent-work-queue-test-output");
    bool full = false;
    check(queue.next(full) == 0 && !full);
    check(queue.next(full) == 0 && !full); // memory pressure deferred this thumbnail
    queue.markThumbOnly(0);
    check(queue.next(full) == 1 && !full);
    queue.focus(3, 0, 0); // foreground must still preempt deferred background work
    check(queue.next(full) == 3 && full);
    queue.markDone(3);
    check(queue.next(full) == 1 && !full);
    queue.markThumbOnly(1);
    check(queue.next(full) == 2 && !full);
    queue.markThumbOnly(2);
    check(queue.next(full) == -1);
    WorkQueue bounds(3, "nonexistent-work-queue-test-output");
    bounds.focus(100, 0, 0);
    check(bounds.next(full) == 2 && full);
    bounds.focus(-100, 0, 0);
    check(bounds.next(full) == 0 && full);
}
