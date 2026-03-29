#!/usr/bin/env bash
# test-archive-worker.sh — Functional tests for comiscopio-worker (archive formats).
#
# Usage:
#   bash test-archive-worker.sh --worker <path> --fixtures <path> [--output <path>]
#
# Required:
#   --worker    path to comiscopio-worker binary
#   --fixtures  path to test/fixtures/archive/ directory
#
# Optional:
#   --output    base dir for worker output (default: a mktemp -d)
#   --lib-dir   bundled lib dir to prepend to LD_LIBRARY_PATH
#
# Exit code: 0 if all tests pass, 1 if any fail.

set -euo pipefail

# ── argument parsing ────────────────────────────────────────────────────────
WORKER_BIN=""
FIXTURES_DIR=""
OUTPUT_BASE=""
LIB_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --worker)   WORKER_BIN="$2";    shift 2 ;;
        --fixtures) FIXTURES_DIR="$2";  shift 2 ;;
        --output)   OUTPUT_BASE="$2";   shift 2 ;;
        --lib-dir)  LIB_DIR="$2";       shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$WORKER_BIN" || -z "$FIXTURES_DIR" ]]; then
    echo "Usage: $0 --worker <bin> --fixtures <dir> [--output <dir>] [--lib-dir <dir>]" >&2
    exit 1
fi

if [[ ! -x "$WORKER_BIN" ]]; then
    echo "ERROR: worker not found or not executable: $WORKER_BIN" >&2
    exit 1
fi

if [[ ! -d "$FIXTURES_DIR" ]]; then
    echo "ERROR: fixtures dir not found: $FIXTURES_DIR" >&2
    exit 1
fi

if [[ -z "$OUTPUT_BASE" ]]; then
    OUTPUT_BASE=$(mktemp -d)
    trap 'rm -rf "$OUTPUT_BASE"' EXIT
fi

PASS=0
FAIL=0

# Wrap worker invocations to scope LD_LIBRARY_PATH only to the worker process.
# Exporting it globally breaks system commands (e.g. mkdir on SELinux-enabled Ubuntu)
# that also link against libselinux and would pick up the bundled version.
worker_exec() {
    if [[ -n "$LIB_DIR" ]]; then
        LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$WORKER_BIN" "$@"
    else
        "$WORKER_BIN" "$@"
    fi
}

# ── cleanup trap — kill any background workers on exit (normal, Ctrl+C, error)
BACKGROUND_PIDS=()
cleanup() {
    for pid in "${BACKGROUND_PIDS[@]:-}"; do
        kill "$pid" 2>/dev/null || true
    done
}
trap cleanup EXIT INT TERM

# ── helpers ─────────────────────────────────────────────────────────────────

pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

# Run worker in background, wait for archive event + all thumbnails, then kill it.
# The worker does not exit on its own after extraction (it waits for focus commands),
# so we kill it once we have confirmed all expected output is ready.
# Returns the output dir path on success, non-zero on timeout.
run_worker_basic() {
    local name="$1" input="$2" backend="$3" expected_pages="$4"
    # IMPORTANT: stdout.log must live OUTSIDE the worker's output dir.
    # The worker calls fs::remove_all(output) on startup, which would delete
    # the log file the shell just created with >.  Use separate directories.
    local out_dir="$OUTPUT_BASE/${name}_work"   # worker's --output
    local log_dir="$OUTPUT_BASE/${name}_logs"   # our test log files
    mkdir -p "$log_dir"
    # out_dir is created by the worker itself

    # Start worker in background
    worker_exec \
        --input "$input" \
        --output "$out_dir" \
        --backend "$backend" \
        --reader-format jpeg \
        --thumb-width 180 --thumb-quality 60 \
        --reader-max-dimension 800 --reader-quality 82 \
        --vips-concurrency 1 \
        --window-before 0 --window-after 0 \
        > "$log_dir/stdout.log" 2> "$log_dir/stderr.log" < /dev/null &
    local pid=$!
    BACKGROUND_PIDS+=("$pid")

    # Poll until archive event appears (extraction complete)
    local deadline=$((SECONDS + 60))
    local got_archive=false
    while [[ $SECONDS -lt $deadline ]]; do
        if grep -q '"type":"archive"' "$log_dir/stdout.log" 2>/dev/null; then
            got_archive=true
            break
        fi
        # Also check for error event (early exit)
        if grep -q '"type":"error"' "$log_dir/stdout.log" 2>/dev/null; then
            break
        fi
        sleep 0.3
    done

    # If we have an archive event, also wait briefly for background thumbs
    if [[ "$got_archive" == true && "$expected_pages" -gt 1 ]]; then
        local thumb_deadline=$((SECONDS + 15))
        while [[ $SECONDS -lt $thumb_deadline ]]; do
            local count
            count=$(find "$out_dir/thumbs" -name '*.jpg' 2>/dev/null | wc -l)
            [[ "$count" -ge "$expected_pages" ]] && break
            sleep 0.3
        done
    fi

    # Wait for manifest.json to be fully written (worker writes it after the archive event)
    if [[ "$got_archive" == true ]]; then
        local manifest_deadline=$((SECONDS + 5))
        while [[ $SECONDS -lt $manifest_deadline ]]; do
            [[ -s "$out_dir/manifest.json" ]] && \
                python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$out_dir/manifest.json" 2>/dev/null && \
                break
            sleep 0.1
        done
    fi

    # Kill the worker now that we have what we need (or timed out)
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true

    if [[ "$got_archive" == false ]] && ! grep -q '"type":"error"' "$log_dir/stdout.log" 2>/dev/null; then
        echo "  [FATAL] $name: timeout waiting for archive/error event (>60s)" >&2
        return 1
    fi
}

# Check that stdout contains a JSON-line with the given type and field=value.
assert_event() {
    local label="$1" logfile="$2" type="$3" field="$4" value="$5"
    if grep -q "\"type\":\"$type\"" "$logfile" 2>/dev/null &&
       grep "\"type\":\"$type\"" "$logfile" | grep -q "\"$field\":$value"; then
        pass "$label"
    else
        fail "$label (expected type=$type $field=$value in $logfile)"
        if [[ -f "$logfile" ]]; then
            echo "    stdout: $(cat "$logfile" | head -5)"
        fi
    fi
}

# Check that stdout contains any line with type=<type>
assert_has_event() {
    local label="$1" logfile="$2" type="$3"
    if grep -q "\"type\":\"$type\"" "$logfile" 2>/dev/null; then
        pass "$label"
    else
        fail "$label (expected type=$type in $(basename "$logfile"))"
        [[ -f "$logfile" ]] && echo "    stdout: $(head -3 "$logfile")"
    fi
}

assert_file_exists() {
    local label="$1" filepath="$2"
    if [[ -f "$filepath" && -s "$filepath" ]]; then
        pass "$label"
    else
        fail "$label (missing or empty: $filepath)"
    fi
}

assert_json_valid() {
    local label="$1" filepath="$2"
    if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$filepath" 2>/dev/null; then
        pass "$label"
    else
        fail "$label (invalid JSON: $filepath)"
    fi
}

assert_json_field() {
    local label="$1" filepath="$2" jq_expr="$3" expected="$4"
    local actual
    actual=$(python3 -c "
import json, sys
data = json.load(open(sys.argv[1]))
# simple dotted path: e.g. '.pages | length'
import re
expr = sys.argv[2]
m = re.match(r'\.(\w+)\s*\|\s*length', expr)
if m:
    print(len(data.get(m.group(1), [])))
else:
    m2 = re.match(r'\.(\w+)', expr)
    if m2:
        print(data.get(m2.group(1), ''))
" "$filepath" "$jq_expr" 2>/dev/null || echo "")
    if [[ "$actual" == "$expected" ]]; then
        pass "$label"
    else
        fail "$label (expected '$expected', got '$actual' for $jq_expr in $filepath)"
    fi
}

# ── TEST: basic extraction per format ────────────────────────────────────────

run_basic_test() {
    local label="$1" file="$2" backend="$3" expected_pages="$4"
    local fixture="$FIXTURES_DIR/$file"

    echo ""
    echo "--- $label ---"

    if [[ ! -f "$fixture" ]]; then
        fail "$label: fixture not found: $fixture"
        return
    fi

    run_worker_basic "$label" "$fixture" "$backend" "$expected_pages" || return
    local out_dir="$OUTPUT_BASE/${label}_work"
    local log_dir="$OUTPUT_BASE/${label}_logs"

    # 1. archive event with correct totalPages (from stdout log)
    assert_event "$label: archive event" \
        "$log_dir/stdout.log" "archive" "totalPages" "$expected_pages"

    # 2. manifest.json exists and is valid JSON
    assert_json_valid "$label: manifest.json valid" "$out_dir/manifest.json"

    # 3. page 0 was auto-processed (preview phase) and its file exists on disk
    local page0
    page0=$(find "$out_dir/pages" -name '000000.*' 2>/dev/null | head -1) || true
    if [[ -n "$page0" && -s "$page0" ]]; then
        pass "$label: page 0 processed ($(basename "$page0"))"
    else
        fail "$label: page 0 file missing in $out_dir/pages/"
    fi

    # 4. thumbs directory has expected_pages .jpg files (background thread)
    local thumb_count
    thumb_count=$(find "$out_dir/thumbs" -name '*.jpg' 2>/dev/null | wc -l | tr -d ' ') || true
    if [[ "$thumb_count" -eq "$expected_pages" ]]; then
        pass "$label: $expected_pages thumbnails generated"
    else
        fail "$label: expected $expected_pages thumbnails, found $thumb_count"
    fi
}

echo "========================================"
echo " Archive Worker — Basic Extraction Tests"
echo "========================================"

run_basic_test "cbz_5pages"    "test-5pages.cbz"  "zip" 5
run_basic_test "cbt_5pages"    "test-5pages.cbt"  "tar" 5
run_basic_test "cb7_5pages"    "test-5pages.cb7"  "7z"  5
run_basic_test "cbz_single"    "test-single.cbz"  "zip" 1

# CBR is optional — skip if fixture is missing (rar not available during generation)
if [[ -f "$FIXTURES_DIR/test-5pages.cbr" ]]; then
    run_basic_test "cbr_5pages" "test-5pages.cbr" "rar" 5
else
    echo ""
    echo "--- cbr_5pages ---"
    echo "  [SKIP] test-5pages.cbr not found (rar not available)"
fi

# ── TEST: error cases ─────────────────────────────────────────────────────

echo ""
echo "========================================"
echo " Archive Worker — Error Case Tests"
echo "========================================"

# Helper: run worker and wait for it to exit on its own (error/done) or timeout
run_worker_until_exit() {
    local name="$1" input="$2" backend="$3"
    local out_dir="$OUTPUT_BASE/${name}_work"   # worker's --output
    local log_dir="$OUTPUT_BASE/${name}_logs"   # our test log files
    mkdir -p "$log_dir"
    # timeout cannot execute bash functions — use env to inject LD_LIBRARY_PATH inline
    local worker_cmd=("$WORKER_BIN")
    local env_prefix=()
    [[ -n "$LIB_DIR" ]] && env_prefix=(env "LD_LIBRARY_PATH=$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}")
    timeout 30 "${env_prefix[@]}" "$WORKER_BIN" \
        --input "$input" \
        --output "$out_dir" \
        --backend "$backend" \
        --reader-format jpeg \
        --thumb-width 180 --thumb-quality 60 \
        --reader-max-dimension 800 --reader-quality 82 \
        --vips-concurrency 1 --window-before 0 --window-after 0 \
        > "$log_dir/stdout.log" 2> "$log_dir/stderr.log" < /dev/null || true
    echo "$log_dir"
}

echo ""
echo "--- empty_cbz (no images) ---"
{
    # Worker emits archive event with totalPages:0 for empty archives.
    # The bridge (TypeScript) converts this to an error — not the worker itself.
    log_dir=$(run_worker_until_exit "empty_cbz" "$FIXTURES_DIR/test-empty.cbz" "zip")
    assert_event "empty_cbz: archive event with 0 pages" "$log_dir/stdout.log" "archive" "totalPages" "0"
}

echo ""
echo "--- not_images_tar (TAR of CBRs) ---"
{
    log_dir=$(run_worker_until_exit "not_images_tar" "$FIXTURES_DIR/test-not-images.tar" "tar")
    assert_event "not_images_tar: archive event with 0 pages" "$log_dir/stdout.log" "archive" "totalPages" "0"
}

# ── TEST: focus / ready protocol ─────────────────────────────────────────────

echo ""
echo "========================================"
echo " Archive Worker — Focus/Ready Protocol"
echo "========================================"
echo ""
echo "--- focus_ready (page 2 of test-5pages.cbz) ---"

{
    out_dir="$OUTPUT_BASE/focus_ready_work"
    log_dir="$OUTPUT_BASE/focus_ready_logs"
    mkdir -p "$log_dir"
    fifo="$log_dir/stdin_pipe"
    mkfifo "$fifo"

    # Launch worker with named pipe as stdin; stdout appended to log
    worker_exec \
        --input "$FIXTURES_DIR/test-5pages.cbz" \
        --output "$out_dir" \
        --backend zip \
        --reader-format jpeg \
        --thumb-width 180 --thumb-quality 60 \
        --reader-max-dimension 800 --reader-quality 82 \
        --vips-concurrency 1 --window-before 0 --window-after 0 \
        > "$log_dir/stdout.log" 2> "$log_dir/stderr.log" < "$fifo" &
    WORKER_PID=$!
    BACKGROUND_PIDS+=("$WORKER_PID")

    # Open write end of fifo so the pipe stays open
    exec 4> "$fifo"

    # Waits for a JSON event of a given type in the log (timeout in seconds)
    wait_for_event() {
        local type="$1" timeout_secs="$2"
        local deadline=$((SECONDS + timeout_secs))
        while [[ $SECONDS -lt $deadline ]]; do
            grep -q "\"type\":\"$type\"" "$log_dir/stdout.log" 2>/dev/null && return 0
            sleep 0.2
        done
        return 1
    }

    # Step 1: wait for archive event (extraction complete)
    if wait_for_event "archive" 30; then
        pass "focus_ready: archive event received"
    else
        fail "focus_ready: timeout waiting for archive event"
        exec 4>&-
        kill "$WORKER_PID" 2>/dev/null || true
        wait "$WORKER_PID" 2>/dev/null || true
        # continue to final summary
    fi

    # Step 2: send focus command for page 2 (0-indexed)
    echo '{"type":"focus","page":2}' >&4

    # Step 3: wait for ready event for page 2
    wait_ready_page2() {
        local deadline=$((SECONDS + 15))
        while [[ $SECONDS -lt $deadline ]]; do
            if grep -q '"type":"ready"' "$log_dir/stdout.log" 2>/dev/null &&
               grep '"type":"ready"' "$log_dir/stdout.log" | grep -q '"page":2'; then
                return 0
            fi
            sleep 0.2
        done
        return 1
    }

    if wait_ready_page2; then
        pass "focus_ready: ready event for page 2 received"
    else
        fail "focus_ready: timeout waiting for ready event (page 2)"
    fi

    # Step 4: verify the page file exists on disk with size > 0
    page_file=$(find "$out_dir/pages" -name '000002.*' 2>/dev/null | head -1) || true
    if [[ -n "$page_file" && -s "$page_file" ]]; then
        pass "focus_ready: page file exists on disk ($(basename "$page_file"))"
    else
        fail "focus_ready: page file missing or empty in $out_dir/pages/"
    fi

    # Step 5: verify thumbnail for page 2 exists
    assert_file_exists "focus_ready: thumbnail for page 2" "$out_dir/thumbs/000002.jpg"

    # Step 6: quit cleanly
    echo '{"type":"quit"}' >&4
    exec 4>&-

    # Wait for clean exit (up to 3 seconds)
    for _ in {1..15}; do
        kill -0 "$WORKER_PID" 2>/dev/null || break
        sleep 0.2
    done
    if kill -0 "$WORKER_PID" 2>/dev/null; then
        kill "$WORKER_PID" 2>/dev/null || true
        fail "focus_ready: worker did not exit cleanly after quit"
    else
        pass "focus_ready: worker exited cleanly"
    fi
    wait "$WORKER_PID" 2>/dev/null || true
    rm -f "$log_dir/stdin_pipe"
}

# ── summary ──────────────────────────────────────────────────────────────────

echo ""
echo "========================================"
echo " Archive Worker Tests — Summary"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "========================================"

[[ $FAIL -eq 0 ]]
