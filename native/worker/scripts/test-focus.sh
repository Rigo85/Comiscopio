#!/bin/bash
set -e

WORKER="$(dirname "$0")/../build/comiscopio-worker"
INPUT="$1"
OUTPUT="/tmp/comiscopio-focus-test"

if [ -z "$INPUT" ]; then
    echo "Usage: $0 <path-to-cbr-file>"
    exit 1
fi

echo "=== Focus Priority Test ==="
echo "Input: $INPUT"
echo ""

STDOUT_LOG="/tmp/comiscopio-focus-stdout.log"
> "$STDOUT_LOG"

# Launch worker, feed focus commands
# Wait for "archive" event before sending focus commands
{
    # Wait for extraction to finish (Phase 1)
    # The worker emits {"type":"archive",...} when ready
    sleep 20  # generous wait for 2.7GB extraction

    echo >&2 ">>> [$(date +%H:%M:%S.%3N)] Focus -> page 0"
    echo '{"type":"focus","page":0}'
    sleep 1

    echo >&2 ">>> [$(date +%H:%M:%S.%3N)] Focus -> page 50"
    echo '{"type":"focus","page":50}'
    sleep 1

    echo >&2 ">>> [$(date +%H:%M:%S.%3N)] Focus -> page 300"
    echo '{"type":"focus","page":300}'
    sleep 1

    echo >&2 ">>> [$(date +%H:%M:%S.%3N)] Focus -> page 500"
    echo '{"type":"focus","page":500}'
    sleep 1

    echo >&2 ">>> [$(date +%H:%M:%S.%3N)] Focus -> page 1000"
    echo '{"type":"focus","page":1000}'
    sleep 1

    echo >&2 ">>> [$(date +%H:%M:%S.%3N)] Focus -> page 10"
    echo '{"type":"focus","page":10}'
    sleep 1

    echo >&2 ">>> [$(date +%H:%M:%S.%3N)] Focus -> page 50 (should be cached)"
    echo '{"type":"focus","page":50}'

    # Wait for all processing
    sleep 60

    echo '{"type":"quit"}'
} | "$WORKER" \
    --input "$INPUT" \
    --output "$OUTPUT" \
    --backend rar \
    > "$STDOUT_LOG" 2>&1

echo ""
echo "=== RESULTS ==="
echo ""

echo "--- Extraction ---"
grep 'Phase 1' "$STDOUT_LOG" 2>/dev/null

echo ""
echo "--- Ready events (time = from disk read to artifacts written) ---"
grep '"type":"ready"' "$STDOUT_LOG" 2>/dev/null | python3 -c "
import sys, json
for line in sys.stdin:
    d = json.loads(line)
    print(f'  Page {d[\"page\"]:>4} ready in {d[\"ms\"]:>8.1f}ms')
"

echo ""
echo "--- Focus log ---"
grep '\[worker\] Focus' "$STDOUT_LOG" 2>/dev/null

echo ""
echo "--- Disk ---"
echo "thumbs: $(ls "$OUTPUT/thumbs/" 2>/dev/null | wc -l)"
echo "pages:  $(ls "$OUTPUT/pages/" 2>/dev/null | wc -l)"
echo "raw:    $(ls "$OUTPUT/raw/" 2>/dev/null | wc -l)"
du -sh "$OUTPUT" 2>/dev/null

echo ""
echo "--- Final ---"
grep '\[worker\] Complete\|Cancel' "$STDOUT_LOG" 2>/dev/null
