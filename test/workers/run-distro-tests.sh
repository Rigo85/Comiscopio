#!/usr/bin/env bash
# run-distro-tests.sh — Run functional worker tests across a matrix of Docker distros.
#
# Reads the list of images from distros.txt (or --distros-file), validates each image
# is available (locally cached or pullable), runs the worker tests inside a container,
# and prints a pass/fail summary at the end.
#
# Usage:
#   bash test/workers/run-distro-tests.sh [options]
#
# Options:
#   --distros-file <path>   Distros list (default: distros.txt next to this script)
#   --native-dir <path>     Native dir with bin/ and lib/ (default: release/linux-unpacked/resources/native)
#   --fixtures-dir <path>   Fixtures dir (default: test/fixtures)
#   --pull                  Pull images not present in local Docker cache
#   --only-archive          Pass through to run-worker-tests.sh
#   --only-doc              Pass through to run-worker-tests.sh
#   --keep-output           Pass through to run-worker-tests.sh (output kept inside container; implies logs)
#
# Exit code: 0 if all non-skipped distros pass, 1 otherwise.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── argument parsing ────────────────────────────────────────────────────────
DISTROS_FILE="$SCRIPT_DIR/distros.txt"
NATIVE_DIR=""
FIXTURES_DIR="$REPO_ROOT/test/fixtures"
PULL=false
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --distros-file)  DISTROS_FILE="$2";        shift 2 ;;
        --native-dir)    NATIVE_DIR="$2";           shift 2 ;;
        --fixtures-dir)  FIXTURES_DIR="$2";         shift 2 ;;
        --pull)          PULL=true;                 shift ;;
        --only-archive)  PASSTHROUGH_ARGS+=(--only-archive); shift ;;
        --only-doc)      PASSTHROUGH_ARGS+=(--only-doc);     shift ;;
        --keep-output)   PASSTHROUGH_ARGS+=(--keep-output);  shift ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

# ── resolve native dir ───────────────────────────────────────────────────────
if [[ -z "$NATIVE_DIR" ]]; then
    NATIVE_DIR="$REPO_ROOT/release/linux-unpacked/resources/native"
fi

# ── pre-flight checks ────────────────────────────────────────────────────────
abort() { echo "ERROR: $*" >&2; exit 1; }

command -v docker &>/dev/null  || abort "docker not found in PATH"
[[ -f "$DISTROS_FILE" ]]       || abort "distros file not found: $DISTROS_FILE"
[[ -d "$NATIVE_DIR/bin" ]]     || abort "native dir not found: $NATIVE_DIR — run 'npm run pack' first"
[[ -d "$FIXTURES_DIR/archive" && -d "$FIXTURES_DIR/doc" ]] \
    || abort "fixtures not found at $FIXTURES_DIR — run 'python3 test/fixtures/generate-fixtures.py' first"

# ── read distros ─────────────────────────────────────────────────────────────
IMAGES=()
while IFS= read -r line; do
    # strip comments and leading/trailing whitespace
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    IMAGES+=("$line")
done < "$DISTROS_FILE"

[[ ${#IMAGES[@]} -eq 0 ]] && abort "no images found in $DISTROS_FILE"

# ── validate images ──────────────────────────────────────────────────────────
# Returns 0 if the image is available locally or can be pulled.
# Sets global SKIP_REASON on failure.
SKIP_REASON=""
validate_image() {
    local image="$1"
    # Check local cache first (fast, no network)
    if docker image inspect "$image" &>/dev/null; then
        return 0
    fi
    if [[ "$PULL" == true ]]; then
        echo "  pulling $image..."
        if docker pull "$image" &>/dev/null; then
            return 0
        else
            SKIP_REASON="pull failed"
            return 1
        fi
    else
        SKIP_REASON="not in local cache (use --pull to download)"
        return 1
    fi
}

# ── result tracking ──────────────────────────────────────────────────────────
declare -A RESULT      # image -> PASS | FAIL | SKIP
declare -A ELAPSED     # image -> seconds
declare -A SKIP_MSG    # image -> reason

# ── run tests ────────────────────────────────────────────────────────────────
# Parent dir of NATIVE_DIR (the linux-unpacked dir) — mounted read-only into the container
APP_DIR="$(dirname "$(dirname "$NATIVE_DIR")")"   # .../release/linux-unpacked
NATIVE_INSIDE="/app/resources/native"
FIXTURES_INSIDE="/test/fixtures"
WORKER_TESTS_INSIDE="/test/workers/run-worker-tests.sh"

echo ""
echo "┌─────────────────────────────────────────────────┐"
echo "│  Comiscopio — Distro Functional Test Matrix      │"
echo "├─────────────────────────────────────────────────┤"
printf "│  distros  : %-35s│\n" "$(basename "$DISTROS_FILE") (${#IMAGES[@]} images)"
printf "│  native   : %-35s│\n" "$(basename "$APP_DIR")/..."
printf "│  fixtures : %-35s│\n" "$(basename "$FIXTURES_DIR")"
echo "└─────────────────────────────────────────────────┘"

for image in "${IMAGES[@]}"; do
    echo ""
    echo "┄┄┄ $image ┄┄┄"

    # Validate image availability
    if ! validate_image "$image"; then
        echo "  [SKIP] $SKIP_REASON"
        RESULT["$image"]="SKIP"
        SKIP_MSG["$image"]="$SKIP_REASON"
        ELAPSED["$image"]="—"
        continue
    fi

    t_start=$SECONDS

    # Build docker run command
    docker_cmd=(
        docker run --rm
        -v "${APP_DIR}:/app:ro"
        -v "${REPO_ROOT}/test:/test:ro"
        "$image"
        bash "$WORKER_TESTS_INSIDE"
            --native-dir "$NATIVE_INSIDE"
            --fixtures-dir "$FIXTURES_INSIDE"
    )
    [[ ${#PASSTHROUGH_ARGS[@]} -gt 0 ]] && docker_cmd+=("${PASSTHROUGH_ARGS[@]}")

    set +e
    "${docker_cmd[@]}"
    exit_code=$?
    set -e

    elapsed=$(( SECONDS - t_start ))
    ELAPSED["$image"]="${elapsed}s"

    if [[ $exit_code -eq 0 ]]; then
        RESULT["$image"]="PASS"
    else
        RESULT["$image"]="FAIL"
    fi
done

# ── summary ───────────────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

echo ""
echo "════════════════════════════════════════════════════"
echo "  Distro Test Matrix — Summary"
echo "════════════════════════════════════════════════════"
printf "  %-30s  %-6s  %s\n" "Image" "Result" "Time"
echo "  ──────────────────────────────────────────────────"

for image in "${IMAGES[@]}"; do
    r="${RESULT[$image]:-SKIP}"
    t="${ELAPSED[$image]:-—}"
    note=""
    case "$r" in
        PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
        FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
        SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)); note="  (${SKIP_MSG[$image]:-})" ;;
    esac
    printf "  %-30s  %-6s  %s%s\n" "$image" "$r" "$t" "$note"
done

echo "  ──────────────────────────────────────────────────"
echo "  PASS: $PASS_COUNT   FAIL: $FAIL_COUNT   SKIP: $SKIP_COUNT"
echo "════════════════════════════════════════════════════"

[[ $FAIL_COUNT -eq 0 ]]
