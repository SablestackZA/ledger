#!/usr/bin/env bash
# One load-test run from a clean slate: empty ledger, 1,000 accounts, fresh server, k6 in Docker.
# Usage: loadtest/run.sh 500   (writes loadtest/reports/local-<today>-500.json)
# Needs LEDGER_DATABASE_URL (or DATABASE_URL), LEDGER_API_KEY, LEDGER_API_KEY_SHA256 and a built app.
set -euo pipefail

RATE="${1:?usage: loadtest/run.sh <requests-per-second>}"
DURATION="${DURATION:-60s}"
DATE="${REPORT_DATE:-$(date +%F)}"
PORT="${PORT:-3000}"

cd "$(dirname "$0")/.."
if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi

# This script truncates the ledger. Never point it at a hosted database.
case "${LEDGER_DATABASE_URL:-${DATABASE_URL:-}}" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "Refusing to run: the app database URL is not local." >&2; exit 1 ;;
esac

LOG="$(mktemp)"
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  (lsof -ti "tcp:$PORT" | xargs kill) 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT

pnpm db:up
docker compose exec -T db psql -q -U ledger -d ledger -c "truncate entries, transactions, accounts restart identity"
pnpm db:seed

PORT="$PORT" pnpm start >"$LOG" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  curl -fs "http://localhost:$PORT/v1/health" >/dev/null && break
  sleep 0.5
done
curl -fs "http://localhost:$PORT/v1/health" >/dev/null

docker run --rm \
  -e LEDGER_API_KEY -e "RATE=$RATE" -e "DURATION=$DURATION" -e "RUN_ID=$DATE-$RATE" \
  -e "BASE_URL=http://host.docker.internal:$PORT" \
  -v "$PWD/loadtest:/loadtest" \
  grafana/k6 run --summary-export="/loadtest/reports/local-$DATE-$RATE.json" /loadtest/post.js
