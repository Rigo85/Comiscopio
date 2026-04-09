#!/bin/bash
# Runs INSIDE the Docker container.
# Builds both workers with static small deps, then bundles dynamic deps.
set -euo pipefail

NATIVE="/workspace/native"
VENDOR="$NATIVE/vendor/linux-x64"

mkdir -p "$VENDOR/bin"

# Always start from a clean release build to avoid stale CMake cache issues
rm -rf "$NATIVE/worker/build-release"
rm -rf "$NATIVE/ace-helper/build-release"
rm -rf "$NATIVE/doc-worker/build-release"
# Remove any accidental in-source CMake artifacts
rm -f "$NATIVE/worker/CMakeCache.txt"   "$NATIVE/ace-helper/CMakeCache.txt"   "$NATIVE/doc-worker/CMakeCache.txt"
rm -rf "$NATIVE/worker/CMakeFiles"      "$NATIVE/ace-helper/CMakeFiles"      "$NATIVE/doc-worker/CMakeFiles"

echo "==================================================================="
echo " Building comiscopio-worker  (archive: CBZ/CBR/CB7/TAR)"
echo "==================================================================="
cmake -B "$NATIVE/worker/build-release" \
      -S "$NATIVE/worker" \
      -DCMAKE_BUILD_TYPE=Release \
      -DUSE_STATIC_DEPS=ON
cmake --build "$NATIVE/worker/build-release" -j"$(nproc)"
cp "$NATIVE/worker/build-release/comiscopio-worker" "$VENDOR/bin/"
echo "OK: comiscopio-worker"

echo ""
echo "==================================================================="
echo " Building comiscopio-ace-helper  (archive: ACE/CBA)"
echo "==================================================================="
cmake -B "$NATIVE/ace-helper/build-release" \
      -S "$NATIVE/ace-helper" \
      -DCMAKE_BUILD_TYPE=Release
cmake --build "$NATIVE/ace-helper/build-release" -j"$(nproc)"
cp "$NATIVE/ace-helper/build-release/comiscopio-ace-helper" "$VENDOR/bin/"
cp "$NATIVE/ace-helper/build-release/comiscopio-unace" "$VENDOR/bin/"
echo "OK: comiscopio-ace-helper"

echo ""
echo "==================================================================="
echo " Building comiscopio-doc-worker  (documents: PDF/DjVu/EPUB/XPS)"
echo "==================================================================="
cmake -B "$NATIVE/doc-worker/build-release" \
      -S "$NATIVE/doc-worker" \
      -DCMAKE_BUILD_TYPE=Release \
      -DUSE_STATIC_DEPS=ON
cmake --build "$NATIVE/doc-worker/build-release" -j"$(nproc)"
cp "$NATIVE/doc-worker/build-release/comiscopio-doc-worker" "$VENDOR/bin/"
echo "OK: comiscopio-doc-worker"

echo ""
echo "==================================================================="
echo " Bundling dynamic dependencies"
echo "==================================================================="
bash "$NATIVE/deps/_bundle-deps.sh"

echo ""
echo "==================================================================="
echo " Build complete"
echo "==================================================================="
echo "  Binaries : $VENDOR/bin/"
ls -lh "$VENDOR/bin/"
echo ""
echo "  Libs     : $VENDOR/lib/"
echo "  Count    : $(find "$VENDOR/lib" -name "*.so*" ! -type l | wc -l) shared libraries bundled"
