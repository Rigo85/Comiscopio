#!/usr/bin/env bash
# check-deps.sh — Verify that worker binaries have no unexpected system dependencies.
#
# Usage:
#   bash check-deps.sh <path-to-resources/native>
#
# Exit code:
#   0 — all deps either bundled or in the accepted system list
#   1 — missing ("not found") or unexpected system dependency detected
#
# Example (local):
#   bash test/ldd/check-deps.sh release/linux-unpacked/resources/native
#
# Example (Docker):
#   docker run --rm \
#     -v "$(pwd)/release/linux-unpacked/resources/native:/native:ro" \
#     -v "$(pwd)/test/ldd/check-deps.sh:/check-deps.sh:ro" \
#     ubuntu:22.04 bash /check-deps.sh /native

set -euo pipefail

NATIVE_DIR="${1:-}"
if [[ -z "$NATIVE_DIR" ]]; then
    echo "Usage: $0 <path-to-resources/native>" >&2
    exit 1
fi

BIN_DIR="$NATIVE_DIR/bin"
LIB_DIR="$NATIVE_DIR/lib"

if [[ ! -d "$BIN_DIR" ]]; then
    echo "ERROR: $BIN_DIR does not exist" >&2
    exit 1
fi

# Shared libraries that are always acceptable from the system.
# These are either part of glibc, the kernel vDSO, or the GCC runtime.
SYSTEM_OK=(
    'libc\.so\.'
    'libm\.so\.'
    'libpthread\.so\.'
    'libdl\.so\.'
    'librt\.so\.'
    'libgcc_s\.so\.'
    'libstdc\+\+\.so\.'
    'linux-vdso\.so\.'
    'ld-linux.*\.so\.'
    'ld-musl.*\.so\.'
)

is_system_ok() {
    local soname="$1"
    for pattern in "${SYSTEM_OK[@]}"; do
        if echo "$soname" | grep -qE "$pattern"; then
            return 0
        fi
    done
    return 1
}

OVERALL_MISSING=0
OVERALL_UNEXPECTED=0

check_binary() {
    local binary="$1"
    local name
    name=$(basename "$binary")

    echo ""
    echo "=== check-deps: $name ==="

    if [[ ! -f "$binary" ]]; then
        echo "  ERROR: binary not found: $binary"
        OVERALL_MISSING=$((OVERALL_MISSING + 1))
        return
    fi

    if [[ ! -x "$binary" ]]; then
        echo "  ERROR: binary not executable: $binary"
        OVERALL_MISSING=$((OVERALL_MISSING + 1))
        return
    fi

    local missing=0
    local unexpected=0
    local ldd_output
    # LD_LIBRARY_PATH lets ldd find the bundled libs so we can classify them correctly
    ldd_output=$(LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
                 ldd "$binary" 2>&1) || true

    while IFS= read -r line; do
        # Skip blank lines and the binary name line
        [[ -z "${line// }" ]] && continue
        [[ "$line" == *"$name"* ]] && continue

        # "not found" — critical: dep missing on this system
        if echo "$line" | grep -q 'not found'; then
            soname=$(echo "$line" | awk '{print $1}')
            printf '  [MISSING]    %-35s  NOT FOUND — CRITICAL\n' "$soname"
            missing=$((missing + 1))
            continue
        fi

        # Extract soname from "libfoo.so.1 => /path/to/libfoo.so.1 (0x...)"
        soname=$(echo "$line" | awk '{print $1}')
        resolved=$(echo "$line" | awk '{print $3}')

        # Skip virtual entries (linux-vdso, statically linked indicator)
        if echo "$line" | grep -qE 'linux-vdso|statically linked'; then
            printf '  [VDSO]       %-35s\n' "$soname"
            continue
        fi

        if is_system_ok "$soname"; then
            printf '  [SYSTEM-OK]  %-35s  %s\n' "$soname" "${resolved:-}"
        elif [[ -n "$resolved" ]] && echo "$resolved" | grep -q "$LIB_DIR"; then
            printf '  [BUNDLED]    %-35s  %s\n' "$soname" "$resolved"
        elif [[ -n "$resolved" ]] && [[ -f "$resolved" ]]; then
            # Resolved to a system path that is NOT in our accepted list
            printf '  [UNEXPECTED] %-35s  %s — should be bundled?\n' "$soname" "$resolved"
            unexpected=$((unexpected + 1))
        else
            # Unresolved and not in accepted list
            printf '  [UNKNOWN]    %-35s  (could not classify)\n' "$soname"
        fi
    done <<< "$ldd_output"

    echo ""
    echo "  RESULT: $missing missing, $unexpected unexpected"

    OVERALL_MISSING=$((OVERALL_MISSING + missing))
    OVERALL_UNEXPECTED=$((OVERALL_UNEXPECTED + unexpected))
}

# Check all binaries in bin/
for binary in "$BIN_DIR"/*; do
    [[ -f "$binary" ]] || continue
    check_binary "$binary"
done

echo ""
echo "======================================"
if [[ $OVERALL_MISSING -eq 0 && $OVERALL_UNEXPECTED -eq 0 ]]; then
    echo "=== OVERALL: PASS ($OVERALL_MISSING missing, $OVERALL_UNEXPECTED unexpected) ==="
    exit 0
else
    echo "=== OVERALL: FAIL ($OVERALL_MISSING missing, $OVERALL_UNEXPECTED unexpected) ==="
    exit 1
fi
