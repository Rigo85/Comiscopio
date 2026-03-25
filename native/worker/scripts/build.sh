#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKER_DIR="$(dirname "$SCRIPT_DIR")"

echo "Building comiscopio-worker..."
cmake -B "$WORKER_DIR/build" -S "$WORKER_DIR" -DCMAKE_BUILD_TYPE=Release
cmake --build "$WORKER_DIR/build" -j"$(nproc)"

echo ""
echo "Binary: $WORKER_DIR/build/comiscopio-worker"
echo "Done."
