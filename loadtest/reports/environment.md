# Load-test environment: local, 2026-11-10

Applies to `local-2026-11-10-250.json`, `-500.json`, `-750.json`, `-1000.json` and `-2000.json`. Every figure on the write-up page is read from those files; this file states what they were measured on.

## Machine

| | |
|---|---|
| Machine | Apple M5 Pro (`sysctl -n machdep.cpu.brand_string`) |
| Logical CPUs | 15 |
| Memory | 25,769,803,776 bytes, 24 GiB (`sysctl -n hw.memsize`) |
| OS | macOS 27.2 (build 26B123) |
| Docker | OrbStack 2.2.5, Docker Engine 29.8.2, linux/arm64; VM with 15 CPUs, 12,598,730,752 bytes of memory |
| Postgres | 17.11 (`postgres:17`, Debian, aarch64) in Docker, port 54329 on loopback |
| Postgres settings | image defaults: `max_connections` 100, `shared_buffers` 128MB, `fsync` on, `synchronous_commit` on |
| Node | v24.22.0 (`mise.toml`) |
| pnpm | 9.15.9 |
| Next.js | 16.4.6, production build, one `next start` process, no clustering |
| Driver | `postgres` 4.1.0 |
| Pool size | 20 connections (`DB_POOL_MAX` unset; default in `src/ledger/db.ts`) |
| k6 | v2.3.0 from `grafana/k6` image `sha256:3e4186aea62e11a45560bfc51e19eeafe82fc07ce069c78aff44b7ff893d9a5e`, in Docker |

## What this is

- The app, Postgres and k6 ran on the same laptop and shared its CPUs. k6 reached the app through `host.docker.internal`.
- Each run started from an empty ledger with 1,000 seeded ZAR accounts, a freshly started server and a cold connection pool. No warm-up was excluded.
- Measured on the code before the review changes of the same day (role-level timeouts instead of startup parameters, request id on posting log lines, an extra integrity query). The posting statements are unchanged; the runs were not repeated.
- Each rate was run once for 60 seconds. There are no repeats, so run-to-run variance is unknown.
- The app wrote one JSON log line per request to stdout during every run (`src/http/handler.ts`).
- A transaction is two entries between two accounts picked uniformly at random from the 1,000, amount 1 to 100,000 minor units, with a unique `Idempotency-Key`.
- The figures use the `http_req_duration`, `http_req_failed` and `http_reqs` sub-metrics tagged `endpoint:post_transactions`, so the setup and teardown GETs are excluded. `dropped_iterations` is the k6 count of iterations it could not start because no VU was free.
- Thresholds in `loadtest/post.js`: failed rate 0, p99 under 100 ms, dropped iterations 0.
- After every run the k6 teardown called `GET /v1/integrity`; it returned `ok: true` after all five runs.

## Outcome against the thresholds

| Target req/s | Result |
|---|---|
| 250 | all thresholds met |
| 500 | all thresholds met |
| 750 | p99 threshold crossed; no failed requests, no dropped iterations |
| 1000 | p99 threshold and dropped-iterations threshold crossed; no failed requests |
| 2000 | p99, failed-rate and dropped-iterations thresholds crossed |

The highest tested rate that met every threshold is 500 requests per second on this machine. The cause of the degradation above that rate was not investigated.

## Commands

```sh
cd ledger
cp .env.example .env.local        # then set LEDGER_API_KEY and LEDGER_API_KEY_SHA256 (see README.md)
pnpm install
pnpm build

for rps in 250 500 1000 2000 750; do
  REPORT_DATE=2026-11-10 loadtest/run.sh "$rps"
done
```

`loadtest/run.sh <rps>` runs, in order:

```sh
pnpm db:up
docker compose exec -T db psql -q -U ledger -d ledger -c "truncate entries, transactions, accounts restart identity"
pnpm db:seed                      # 1,000 accounts
PORT=3000 pnpm start &            # waits for GET /v1/health
docker run --rm \
  -e LEDGER_API_KEY -e RATE=<rps> -e DURATION=60s -e RUN_ID=2026-11-10-<rps> \
  -e BASE_URL=http://host.docker.internal:3000 \
  -v "$PWD/loadtest:/loadtest" \
  grafana/k6 run --summary-export=/loadtest/reports/local-2026-11-10-<rps>.json /loadtest/post.js
```
