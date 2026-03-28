#!/bin/bash
# Runs INSIDE the Docker container.
# Collects all non-system dynamic dependencies from both worker binaries,
# copies them to vendor/linux-x64/lib/, sets RPATH on binaries and bundled libs.
set -euo pipefail

VENDOR="/workspace/native/vendor/linux-x64"
BIN_DIR="$VENDOR/bin"
LIB_DIR="$VENDOR/lib"

mkdir -p "$LIB_DIR"

# Returns 0 (true) if the library should NOT be bundled.
# These are guaranteed to be present on any Ubuntu 22.04+ system.
is_system_lib() {
    case "$(basename "$1")" in
        linux-vdso.so*)  return 0 ;;  # kernel virtual DSO, not a real file
        ld-linux*.so*)   return 0 ;;  # dynamic linker — never replace
        libc.so.*)       return 0 ;;  # glibc
        libm.so.*)       return 0 ;;  # math (merged into glibc 2.29+)
        libpthread.so.*) return 0 ;;  # pthreads (merged into glibc 2.34)
        libdl.so.*)      return 0 ;;  # dlfcn (merged into glibc 2.34)
        librt.so.*)      return 0 ;;  # realtime (merged into glibc 2.34)
        libgcc_s.so.*)   return 0 ;;  # GCC runtime (always present)
        libstdc++.so.*)  return 0 ;;  # C++ runtime (present on Ubuntu 22.04+)
    esac
    return 1
}

# Copies the real .so file and creates the SONAME symlink.
install_lib() {
    local src="$1"
    [ -f "$src" ] || return 0

    local real
    real=$(realpath "$src")
    local real_name
    real_name=$(basename "$real")
    local link_name
    link_name=$(basename "$src")

    if [ ! -f "$LIB_DIR/$real_name" ]; then
        cp "$real" "$LIB_DIR/$real_name"
        echo "    + $real_name"
    fi

    # Create SONAME symlink (e.g. libvips.so.42 → libvips.so.42.12.1)
    if [ "$link_name" != "$real_name" ] && [ ! -e "$LIB_DIR/$link_name" ]; then
        ln -sf "$real_name" "$LIB_DIR/$link_name"
        echo "      ↳ $link_name"
    fi
}

echo "Collecting dynamic dependencies..."
for binary in "$BIN_DIR"/comiscopio-worker "$BIN_DIR"/comiscopio-doc-worker; do
    [ -f "$binary" ] || continue
    echo "  $(basename "$binary")"
    while IFS= read -r lib_path; do
        [ -z "$lib_path" ] && continue
        is_system_lib "$lib_path" && continue
        install_lib "$lib_path"
    done < <(ldd "$binary" 2>/dev/null | grep "=>" | awk '{print $3}' | grep "^/")
done

echo ""
echo "Setting RPATH on binaries (\$ORIGIN/../lib)..."
for binary in "$BIN_DIR"/comiscopio-worker "$BIN_DIR"/comiscopio-doc-worker; do
    [ -f "$binary" ] || continue
    patchelf --set-rpath '$ORIGIN/../lib' "$binary"
    echo "  $(basename "$binary")"
done

echo ""
echo "Setting RPATH on bundled libs (\$ORIGIN)..."
for lib in "$LIB_DIR"/*.so*; do
    [ -L "$lib" ] && continue  # skip symlinks, only process real files
    [ -f "$lib" ] || continue
    patchelf --set-rpath '$ORIGIN' "$lib" 2>/dev/null || true
done

n=$(find "$LIB_DIR" -maxdepth 1 -name "*.so*" ! -type l | wc -l)
echo ""
echo "Done. Bundled $n shared libraries to $LIB_DIR"
