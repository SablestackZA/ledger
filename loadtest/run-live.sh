#!/usr/bin/env bash
# Live load test: per rate, a 30 s warm-up at 10 rps then 60 s measured. Stops at the first run that crosses
# a threshold (0 failures, 0 dropped, server-side p99 under P99_MS). Client latency is reported, not judged.
# Creates its own accounts via the API.
#   LEDGER_API_KEY=... loadtest/run-live.sh 25 50 100 200    # writes loadtest/reports/live-<today>-<rps>.json
set -euo pipefail

cd "$(dirname "$0")/.."
: "${LEDGER_API_KEY:?Set LEDGER_API_KEY}"
BASE_URL="${BASE_URL:-https://sablestack-ledger.vercel.app}"
DATE="${REPORT_DATE:-$(date +%F)}"

case "$BASE_URL" in
  http://localhost*|http://127.0.0.1*) echo "That is a local URL; use loadtest/run.sh." >&2; exit 1 ;;
esac

for rate in "$@"; do
  status=0
  docker run --rm \
    -e LEDGER_API_KEY -e MODE=live -e "RATE=$rate" -e "BASE_URL=$BASE_URL" \
    -e "RUN_ID=$DATE-live-$rate-$(date +%H%M%S)" -e "P99_MS=${P99_MS:-100}" \
    -v "$PWD/loadtest:/loadtest" \
    grafana/k6 run --summary-export="/loadtest/reports/live-$DATE-$rate.json" /loadtest/post.js || status=$?
  if [ "$status" -ne 0 ]; then
    echo "Rate $rate stopped the run (k6 exit $status)." >&2
    exit "$status"
  fi
done
