#!/usr/bin/env bash
# run-worker-tests.sh — Orchestrates all worker functional tests.
#
# Detects binaries and fixtures automatically, then delegates to the
# individual test scripts.
#
# ── Quick start (local, no Docker) ──────────────────────────────────────────
#
#   # Using vendor binaries (pre-built, no cmake needed):
#   bash test/workers/run-worker-tests.sh
#
#   # Using a custom native dir (e.g. linux-unpacked):
#   bash test/workers/run-worker-tests.sh \
#     --native-dir release/linux-unpacked/resources/native
#
# ── Docker (multi-distro) ───────────────────────────────────────────────────
#
#   npm run pack   # creates release/linux-unpacked/
#
#   docker run --rm \
#     -v "$(pwd)/release/linux-unpacked:/app:ro" \
#     -v "$(pwd)/test:/test:ro" \
#     ubuntu:22.04 \
#     bash /test/workers/run-worker-tests.sh \
#       --native-dir /app/resources/native \
#       --fixtures-dir /test/fixtures
#
# ── Arguments ───────────────────────────────────────────────────────────────
#   --native-dir   <path>   Directory with bin/ and lib/ subdirs.
#                           Default: auto-detect from repo root.
#   --fixtures-dir <path>   Directory containing archive/ and doc/ subdirs.
#                           Default: test/fixtures/ relative to repo root.
#   --only-archive          Run only archive worker tests.
#   --only-doc              Run only doc worker tests.
#   --keep-output           Do not delete worker output on success.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── argument parsing ────────────────────────────────────────────────────────
NATIVE_DIR=""
FIXTURES_DIR=""
ONLY_ARCHIVE=false
ONLY_DOC=false
KEEP_OUTPUT=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --native-dir)    NATIVE_DIR="$2";    shift 2 ;;
        --fixtures-dir)  FIXTURES_DIR="$2";  shift 2 ;;
        --only-archive)  ONLY_ARCHIVE=true;  shift ;;
        --only-doc)      ONLY_DOC=true;      shift ;;
        --keep-output)   KEEP_OUTPUT=true;   shift ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

# ── auto-detect native dir ──────────────────────────────────────────────────
if [[ -z "$NATIVE_DIR" ]]; then
    PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
    # linux-x86_64 → linux-x64
    PLATFORM="${PLATFORM/x86_64/x64}"

    CANDIDATES=(
        "$REPO_ROOT/native/vendor/$PLATFORM"
        "$REPO_ROOT/release/linux-unpacked/resources/native"
    )
    for candidate in "${CANDIDATES[@]}"; do
        if [[ -d "$candidate/bin" ]]; then
            NATIVE_DIR="$candidate"
            break
        fi
    done
fi

if [[ -z "$NATIVE_DIR" || ! -d "$NATIVE_DIR/bin" ]]; then
    echo "ERROR: Could not find native dir with bin/ subdirectory." >&2
    echo "  Tried: ${CANDIDATES[*]:-<none>}" >&2
    echo "  Pass --native-dir explicitly, or run 'npm run pack' first." >&2
    exit 1
fi

# ── fixtures dir ────────────────────────────────────────────────────────────
if [[ -z "$FIXTURES_DIR" ]]; then
    FIXTURES_DIR="$REPO_ROOT/test/fixtures"
fi

if [[ ! -d "$FIXTURES_DIR/archive" || ! -d "$FIXTURES_DIR/doc" ]]; then
    echo "ERROR: Fixtures not found at $FIXTURES_DIR" >&2
    echo "  Run: python3 test/fixtures/generate-fixtures.py" >&2
    exit 1
fi

# ── binary paths ────────────────────────────────────────────────────────────
ARCHIVE_WORKER="$NATIVE_DIR/bin/comiscopio-worker"
DOC_WORKER="$NATIVE_DIR/bin/comiscopio-doc-worker"
LIB_DIR="$NATIVE_DIR/lib"

# ── shared output dir ────────────────────────────────────────────────────────
OUTPUT_BASE=$(mktemp -d)
if [[ "$KEEP_OUTPUT" == false ]]; then
    trap 'rm -rf "$OUTPUT_BASE"' EXIT
else
    echo "Worker output will be kept at: $OUTPUT_BASE"
fi

# ── ensure required tools are available ──────────────────────────────────────
# Minimal Docker images may be missing python3 (JSON validation) or findutils
# (find command used throughout the test scripts).
_missing_tools=()
command -v python3 &>/dev/null || _missing_tools+=(python3)
command -v find    &>/dev/null || _missing_tools+=(findutils)

if [[ ${#_missing_tools[@]} -gt 0 ]]; then
    echo "Installing missing tools: ${_missing_tools[*]}"
    if command -v apt-get &>/dev/null; then
        apt-get update -qq >/dev/null 2>&1 || true
        apt-get install -y -qq "${_missing_tools[@]}" >/dev/null 2>&1 || true
    elif command -v dnf &>/dev/null; then
        dnf install -y -q "${_missing_tools[@]}" >/dev/null 2>&1 || true
    elif command -v yum &>/dev/null; then
        yum install -y -q "${_missing_tools[@]}" >/dev/null 2>&1 || true
    elif command -v zypper &>/dev/null; then
        zypper --non-interactive install "${_missing_tools[@]}" >/dev/null 2>&1 || true
    else
        echo "WARNING: cannot install ${_missing_tools[*]} — some tests may fail" >&2
    fi
fi

# ── run ──────────────────────────────────────────────────────────────────────
OVERALL_PASS=true

echo ""
echo "┌──────────────────────────────────────────┐"
echo "│  Comiscopio Worker Functional Tests       │"
echo "├──────────────────────────────────────────┤"
echo "│  native dir:   $NATIVE_DIR"
echo "│  fixtures dir: $FIXTURES_DIR"
echo "└──────────────────────────────────────────┘"

if [[ "$ONLY_DOC" == false ]]; then
    if [[ ! -x "$ARCHIVE_WORKER" ]]; then
        echo ""
        echo "WARNING: archive worker not found at $ARCHIVE_WORKER — skipping archive tests"
    else
        echo ""
        bash "$SCRIPT_DIR/test-archive-worker.sh" \
            --worker "$ARCHIVE_WORKER" \
            --fixtures "$FIXTURES_DIR/archive" \
            --output "$OUTPUT_BASE/archive" \
            --lib-dir "$LIB_DIR" || OVERALL_PASS=false
    fi
fi

if [[ "$ONLY_ARCHIVE" == false ]]; then
    if [[ ! -x "$DOC_WORKER" ]]; then
        echo ""
        echo "WARNING: doc worker not found at $DOC_WORKER — skipping doc tests"
    else
        echo ""
        bash "$SCRIPT_DIR/test-doc-worker.sh" \
            --worker "$DOC_WORKER" \
            --fixtures "$FIXTURES_DIR/doc" \
            --output "$OUTPUT_BASE/doc" \
            --lib-dir "$LIB_DIR" || OVERALL_PASS=false
    fi
fi

echo ""
echo "════════════════════════════════════"
if [[ "$OVERALL_PASS" == true ]]; then
    echo "  OVERALL: PASS"
    exit 0
else
    echo "  OVERALL: FAIL"
    exit 1
fi
