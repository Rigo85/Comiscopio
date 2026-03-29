#!/usr/bin/env bash
# test-doc-worker.sh — Functional tests for comiscopio-doc-worker (PDF, EPUB).
#
# Usage:
#   bash test-doc-worker.sh --worker <path> --fixtures <path> [--output <path>]
#
# Required:
#   --worker    path to comiscopio-doc-worker binary
#   --fixtures  path to test/fixtures/doc/ directory
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

# ── helpers (same as test-archive-worker.sh) ─────────────────────────────────

pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

assert_has_event() {
    local label="$1" logfile="$2" type="$3"
    if grep -q "\"type\":\"$type\"" "$logfile" 2>/dev/null; then
        pass "$label"
    else
        fail "$label (expected type=$type in $(basename "$logfile"))"
        [[ -f "$logfile" ]] && echo "    stdout: $(head -3 "$logfile")"
    fi
}

assert_event() {
    local label="$1" logfile="$2" type="$3" field="$4" value="$5"
    if grep -q "\"type\":\"$type\"" "$logfile" 2>/dev/null &&
       grep "\"type\":\"$type\"" "$logfile" | grep -q "\"$field\":$value"; then
        pass "$label"
    else
        fail "$label (expected type=$type $field=$value)"
        [[ -f "$logfile" ]] && echo "    stdout: $(head -5 "$logfile")"
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
import json, sys, re
data = json.load(open(sys.argv[1]))
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
        fail "$label (expected '$expected', got '$actual')"
    fi
}

# Run doc worker in background, wait for archive event + thumbnails, then kill.
run_doc_worker() {
    local name="$1" input="$2" expected_pages="$3"
    local out_dir="$OUTPUT_BASE/${name}_work"   # worker's --output
    local log_dir="$OUTPUT_BASE/${name}_logs"   # our test log files
    mkdir -p "$log_dir"
    # out_dir is created by the worker itself

    worker_exec \
        --input "$input" \
        --output "$out_dir" \
        --reader-format jpeg \
        --thumb-width 180 --thumb-quality 60 \
        --reader-max-dimension 800 --reader-quality 82 \
        --vips-concurrency 1 \
        --window-before 0 --window-after 0 \
        > "$log_dir/stdout.log" 2> "$log_dir/stderr.log" < /dev/null &
    local pid=$!
    BACKGROUND_PIDS+=("$pid")

    local deadline=$((SECONDS + 60))
    local got_archive=false
    while [[ $SECONDS -lt $deadline ]]; do
        if grep -q '"type":"archive"' "$log_dir/stdout.log" 2>/dev/null; then
            got_archive=true; break
        fi
        grep -q '"type":"error"' "$log_dir/stdout.log" 2>/dev/null && break
        sleep 0.3
    done

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

    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true

    if [[ "$got_archive" == false ]] && ! grep -q '"type":"error"' "$log_dir/stdout.log" 2>/dev/null; then
        echo "  [FATAL] $name: timeout (>60s)" >&2
        return 1
    fi
}

# ── TEST: basic extraction per format ────────────────────────────────────────

run_doc_test() {
    local label="$1" file="$2" expected_pages="$3"
    local fixture="$FIXTURES_DIR/$file"

    echo ""
    echo "--- $label ---"

    if [[ ! -f "$fixture" ]]; then
        fail "$label: fixture not found: $fixture"
        return
    fi

    run_doc_worker "$label" "$fixture" "$expected_pages" || return
    local out_dir="$OUTPUT_BASE/${label}_work"
    local log_dir="$OUTPUT_BASE/${label}_logs"

    # 1. archive event with correct totalPages (from stdout log)
    assert_event "$label: archive event" \
        "$log_dir/stdout.log" "archive" "totalPages" "$expected_pages"

    # 2. manifest.json exists and is valid JSON
    assert_json_valid "$label: manifest.json valid" "$out_dir/manifest.json"

    # 3. page 0 was auto-processed (preview phase)
    local page0
    page0=$(find "$out_dir/pages" -name '000000.*' 2>/dev/null | head -1) || true
    if [[ -n "$page0" && -s "$page0" ]]; then
        pass "$label: page 0 processed ($(basename "$page0"))"
    else
        fail "$label: page 0 file missing in $out_dir/pages/"
    fi

    # 4. thumbs generated
    local thumb_count
    thumb_count=$(find "$out_dir/thumbs" -name '*.jpg' 2>/dev/null | wc -l | tr -d ' ') || true
    if [[ "$thumb_count" -eq "$expected_pages" ]]; then
        pass "$label: $expected_pages thumbnails generated"
    else
        fail "$label: expected $expected_pages thumbnails, found $thumb_count"
    fi
}

echo "====================================="
echo " Doc Worker — Basic Extraction Tests"
echo "====================================="

run_doc_test "pdf_5pages"   "test-5pages.pdf"   5
run_doc_test "epub_5pages"  "test-5pages.epub"  5

# ── TEST: focus / ready protocol ─────────────────────────────────────────────

echo ""
echo "====================================="
echo " Doc Worker — Focus/Ready Protocol"
echo "====================================="
echo ""
echo "--- focus_ready PDF (page 1 of test-5pages.pdf) ---"

{
    fixture="$FIXTURES_DIR/test-5pages.pdf"
    out_dir="$OUTPUT_BASE/doc_focus_ready_work"
    log_dir="$OUTPUT_BASE/doc_focus_ready_logs"
    mkdir -p "$log_dir"
    fifo="$log_dir/stdin_pipe"
    mkfifo "$fifo"

    # Start worker with the fifo as stdin
    worker_exec \
        --input "$fixture" \
        --output "$out_dir" \
        --reader-format jpeg \
        --thumb-width 180 --thumb-quality 60 \
        --reader-max-dimension 800 --reader-quality 82 \
        --vips-concurrency 1 \
        --window-before 0 --window-after 0 \
        > "$log_dir/stdout.log" 2> "$log_dir/stderr.log" < "$fifo" &
    WORKER_PID=$!
    BACKGROUND_PIDS+=("$WORKER_PID")
    exec 4> "$fifo"

    wait_for_event() {
        local type="$1" timeout_secs="$2"
        local deadline=$((SECONDS + timeout_secs))
        while [[ $SECONDS -lt $deadline ]]; do
            grep -q "\"type\":\"$type\"" "$log_dir/stdout.log" 2>/dev/null && return 0
            sleep 0.2
        done
        return 1
    }

    if wait_for_event "archive" 30; then
        pass "doc_focus_ready: archive event received"
    else
        fail "doc_focus_ready: timeout waiting for archive event"
    fi

    echo '{"type":"focus","page":1}' >&4

    wait_ready_page1() {
        local deadline=$((SECONDS + 15))
        while [[ $SECONDS -lt $deadline ]]; do
            if grep -q '"type":"ready"' "$log_dir/stdout.log" 2>/dev/null &&
               grep '"type":"ready"' "$log_dir/stdout.log" | grep -q '"page":1'; then
                return 0
            fi
            sleep 0.2
        done
        return 1
    }

    if wait_ready_page1; then
        pass "doc_focus_ready: ready event for page 1 received"
    else
        fail "doc_focus_ready: timeout waiting for ready event (page 1)"
    fi

    page_file=$(find "$out_dir/pages" -name '000001.*' 2>/dev/null | head -1) || true
    if [[ -n "$page_file" && -s "$page_file" ]]; then
        pass "doc_focus_ready: page file exists ($(basename "$page_file"))"
    else
        fail "doc_focus_ready: page file missing in $out_dir/pages/"
    fi

    echo '{"type":"quit"}' >&4
    exec 4>&-

    for _ in {1..15}; do
        kill -0 "$WORKER_PID" 2>/dev/null || break
        sleep 0.2
    done
    if kill -0 "$WORKER_PID" 2>/dev/null; then
        kill "$WORKER_PID" 2>/dev/null || true
        fail "doc_focus_ready: worker did not exit cleanly"
    else
        pass "doc_focus_ready: worker exited cleanly"
    fi
    wait "$WORKER_PID" 2>/dev/null || true
    rm -f "$log_dir/stdin_pipe"
}

# ── TEST: error case — non-existent file ─────────────────────────────────────

echo ""
echo "====================================="
echo " Doc Worker — Error Cases"
echo "====================================="
echo ""
echo "--- nonexistent_file ---"
{
    log_dir="$OUTPUT_BASE/nonexistent_logs"
    mkdir -p "$log_dir"
    set +e
    env_prefix=()
    [[ -n "$LIB_DIR" ]] && env_prefix=(env "LD_LIBRARY_PATH=$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}")
    timeout 10 "${env_prefix[@]}" "$WORKER_BIN" \
        --input "/no/such/file.pdf" \
        --output "$OUTPUT_BASE/nonexistent_work" \
        --reader-format jpeg \
        --thumb-width 180 --thumb-quality 60 \
        --reader-max-dimension 800 --reader-quality 82 \
        --vips-concurrency 1 --window-before 0 --window-after 0 \
        > "$log_dir/stdout.log" 2> "$log_dir/stderr.log" < /dev/null
    exit_code=$?
    set -e

    if [[ $exit_code -ne 0 ]]; then
        pass "nonexistent_file: non-zero exit code ($exit_code)"
    else
        fail "nonexistent_file: expected non-zero exit, got 0"
    fi
}

# ── summary ──────────────────────────────────────────────────────────────────

echo ""
echo "====================================="
echo " Doc Worker Tests — Summary"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "====================================="

[[ $FAIL -eq 0 ]]
