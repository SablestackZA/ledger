# Load-test environments, 2026-11-10

Two environments, kept apart: **Local** (below) and **Live** (at the end). A figure is only meaningful with its environment.

## Local

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

## Live

Applies to `live-2026-11-10-25.json`, `-50.json`, `-100.json` and `-200.json`. Two further 200 req/s attempts that did not count are kept as `live-2026-11-10-200-attempt1.json` and `-attempt2.json`; see "Attempts that did not count".

| | |
|---|---|
| Target | https://sablestack-ledger.vercel.app, `main` at e20865c |
| App | Vercel Functions, Node, region `iad1`, connected as `ledger_app` |
| Database | Neon free tier, `us-east-1`, pooled connection (`-pooler` host, prepared statements off) |
| Client | The laptop above (Apple M5 Pro, macOS 27.2), in South Africa, on the public internet; k6 v2.3.0 in Docker (`grafana/k6@sha256:3e4186aea62e11a45560bfc51e19eeafe82fc07ce069c78aff44b7ff893d9a5e`) |
| Thresholds | failed rate 0, dropped iterations 0, **server-side** p99 under 100 ms (`server_app`). Client-observed latency is exported and published but not a threshold. |
| Procedure | Setup: 200 accounts created through `POST /v1/accounts` (codes `lt-<run id>-NNNN`). Warm-up: 30 s at 10 req/s, tagged `endpoint:warmup` and excluded from every figure. Measurement: 60 s at a constant arrival rate. Rates 25, 50, 100 and 200 req/s, one run each. |
| Server time | The app times each request with `performance.now()` and returns `Server-Timing: db;dur=<ms>, app;dur=<ms>`. `db` is the posting database transaction; `app` is the whole handler. Neither includes anything before the handler starts (function cold start, platform routing) or the network. k6 records both as `server_db` and `server_app`. |
| Client time | k6's `http_req_duration`. It includes the round trip from the client to `iad1`. A probe response carried `x-vercel-id: cpt1::iad1::...`, so requests enter at the Cape Town edge and run in `iad1`. |

### Client network, measured before the first live run

20 requests to `GET /v1/health` with curl, plus 10 ICMP pings, to `sablestack-ledger.vercel.app` (anycast address, so these reach the nearest Vercel edge, not `iad1`):

| Measure | Median | Min | Max |
|---|---|---|---|
| ICMP round trip (ping, average of 10) | 9.862 ms | 5.694 ms | 15.398 ms |
| TCP connect (curl `time_connect`) | 10.8 ms | 7.5 ms | 23.3 ms |
| TCP + TLS done (curl `time_appconnect`) | 90.2 ms | 75.6 ms | 203.3 ms |
| First byte of `/v1/health`, new connection (curl `time_starttransfer`) | 397.6 ms | 372.8 ms | 502.7 ms |

The TCP and ICMP figures are to the edge; the distance to `iad1` shows up in the application timings, not here.

### Outcome

| Target req/s | Result |
|---|---|
| 25 | all thresholds met |
| 50 | all thresholds met |
| 100 | all thresholds met |
| 200 | all thresholds met |

No failed requests and no dropped iterations in any of the four. The client-observed minimum was between 276 and 282 ms in every run while the server-side median was between 21 and 28 ms, so most of the client-observed time is the path between this client and `iad1`, not the ledger. Rates above 200 were not tried.

### Attempts that did not count

- **200 req/s, attempt 1** (`live-2026-11-10-200-attempt1.json`): 41 dropped iterations out of 12,001 scheduled, 0 failed requests, server-side p99 68.66 ms as k6 printed it. k6 had 50 pre-allocated VUs; at about 300 ms per round trip 200 req/s needs roughly 100, and VUs created during the run delay iterations, which k6 counts as dropped. That is the load generator, not the server. Live mode now pre-allocates 0.8 x rate VUs (160 at 200 req/s).
- **200 req/s, attempt 2** (`live-2026-11-10-200-attempt2.json`): 52.48% failed requests. The run id was the same as attempt 1, so the idempotency keys and account codes repeated and the ledger refused the repeated keys that carried different bodies. I did not log status codes; the cause is inferred from the ledger's transaction count rising by exactly the 5,703 successful posts (warm-up included) and from the failure disappearing once `run-live.sh` added a time suffix to the run id. It is not a ledger result.
- **25 req/s on the earlier code** (commit c8df7ea): a first live run judged on client p99 under 250 ms crossed it with a client minimum of 281.61 ms. Superseded; its report was overwritten.

Runs 25, 50 and 100 used run id `2026-11-10-live-<rps>` and 50 pre-allocated VUs (60 seen, including the warm-up's 10); the published 200 run used the larger pre-allocation and a run id with a time suffix. Nothing else differed between them.

### Integrity after the runs

The k6 teardown called `GET /v1/integrity` after every run, including the attempts, and each returned `ok: true`. A final call by hand after the last run returned `ok: true` with 0 unbalanced transactions, 0 transactions under two entries and 0 drifted accounts, over 1,050 accounts, 42,170 transactions and 84,340 entries.

### Commands

```sh
LEDGER_API_KEY=<write key> REPORT_DATE=2026-11-10 loadtest/run-live.sh 25 50 100 200
```

`run-live.sh` runs, per rate:

```sh
docker run --rm -e LEDGER_API_KEY -e MODE=live -e RATE=<rps> -e BASE_URL=https://sablestack-ledger.vercel.app \
  -e RUN_ID=2026-11-10-live-<rps>-<hhmmss> -e P99_MS=100 -v "$PWD/loadtest:/loadtest" \
  grafana/k6 run --summary-export=/loadtest/reports/live-2026-11-10-<rps>.json /loadtest/post.js
```
