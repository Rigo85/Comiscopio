#!/bin/bash
# Runs INSIDE the Docker container.
# Builds both workers with static small deps, then bundles dynamic deps.
set -euo pipefail

NATIVE="/workspace/native"
VENDOR="$NATIVE/vendor/linux-x64"

mkdir -p "$VENDOR/bin"

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
