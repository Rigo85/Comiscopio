#!/bin/bash
# Builds the native workers and ACE helper for Linux x64 inside an Ubuntu 22.04 Docker container.
#
# Output: native/vendor/linux-x64/
#   bin/  — comiscopio-worker, comiscopio-ace-helper, comiscopio-unace, comiscopio-doc-worker  (RPATH set)
#   lib/  — all bundled .so dependencies
#
# Usage:
#   ./native/deps/build-linux-x64.sh
#
# Requirements: Docker
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE="comiscopio-linux-builder"

echo "==================================================================="
echo " Comiscopio — Linux x64 native worker build"
echo " Base image : ubuntu:22.04  (glibc 2.35, GCC 11)"
echo " Output     : native/vendor/linux-x64/"
echo "==================================================================="

echo ""
echo "--- Building Docker image ---"
docker build \
    --file "$SCRIPT_DIR/Dockerfile.linux-x64" \
    --tag  "$IMAGE" \
    "$SCRIPT_DIR"

echo ""
echo "--- Running build in container ---"
docker run --rm \
    --volume "$REPO_ROOT:/workspace" \
    --user   "$(id -u):$(id -g)" \
    --env    HOME=/tmp \
    "$IMAGE" \
    bash /workspace/native/deps/_container-build.sh

echo ""
echo "Done. Run 'npm run dist:linux' to package."
