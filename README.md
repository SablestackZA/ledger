# Sablestack Ledger

A double-entry ledger API with a live integrity check and a reproducible load-test report. Built in-house by Sablestack (Pty) Ltd.

- Every transaction sums to zero per currency. Every cached account balance equals the sum of its entries. `GET /v1/integrity` proves both on demand.
- Posting is one database transaction: ordered row locks, idempotent on a client key, with Postgres triggers as a backstop.
- Money is `bigint` minor units with an ISO 4217 currency, serialised as strings.

Design contract: [`docs/superpowers/specs/2026-11-10-ledger-backend-design.md`](docs/superpowers/specs/2026-11-10-ledger-backend-design.md).

## Stack

Next.js 16 (App Router, route handlers), React 19, TypeScript strict, Postgres 17, the `postgres` driver, zod, plain SQL migrations, vitest, k6. Node 24 and pnpm 9 are pinned in `mise.toml`.

## Run it

Requires Docker, Node 24 and pnpm 9 (`mise install` reads `mise.toml`).

```sh
pnpm install
pnpm db:up                    # postgres:17 on 127.0.0.1:54329
cp .env.example .env.local    # then set LEDGER_API_KEY and LEDGER_API_KEY_SHA256 (below)
pnpm db:migrate               # as the owner role
pnpm dev
```

Generate the write key. The server stores only its hash:

```sh
export LEDGER_API_KEY=$(openssl rand -hex 24)
printf %s "$LEDGER_API_KEY" | shasum -a 256 | cut -d' ' -f1   # put this in LEDGER_API_KEY_SHA256
```

Post a transaction:

```sh
curl -X POST localhost:3000/v1/accounts \
  -H "authorization: Bearer $LEDGER_API_KEY" -H "idempotency-key: a1" -H "content-type: application/json" \
  -d '{"code":"1000","name":"Cash","type":"asset","currency":"ZAR"}'
```

Writes need `Authorization: Bearer <key>` and an `Idempotency-Key` header. Reads are public.

### Environment

| Variable | Used by | Meaning |
|---|---|---|
| `LEDGER_DATABASE_URL` | app, `pnpm db:seed` | Connection as the restricted `ledger_app` role. Falls back to `DATABASE_URL`. Neon pooled URL in production. |
| `MIGRATE_DATABASE_URL` | `pnpm db:migrate` | Owner connection, unpooled. Falls back to `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`. Never set on the running app. |
| `LEDGER_API_KEY_SHA256` | app | Hex SHA-256 of the write key. Unset means every write is refused. |
| `LEDGER_API_KEY` | clients, `loadtest/run.sh` | The plain write key. The server never reads it. |
| `CRON_SECRET` | `/api/cron/reset` | Bearer secret for the nightly demo reset (Vercel Cron sends it). |
| `DB_POOL_MAX` | app | Optional. Connections per server process. Default 20. |

`DATABASE_URL` is owned by the Vercel Neon integration and points at the owner role. The app prefers `LEDGER_DATABASE_URL`, and when `VERCEL_ENV` is set it checks `select current_user`: anything but `ledger_app` makes `/v1/health` return 503 and refuses writes and the cron reset. Reads on the pages keep working.

## Test

```sh
pnpm test         # starts the compose database, then runs vitest
pnpm typecheck
pnpm lint
```

Integration tests call the route handlers with real `Request` objects against Postgres (database `ledger_test` on the compose instance). There is no fake database, because part of the correctness lives in SQL triggers and row locks. The suite covers every endpoint, idempotent replay and conflict, reversal twice, unbalanced entries, the trigger backstop with raw SQL, role privileges, 200 parallel transfers between 3 accounts, the nightly reset, and the deployed-role check.

## Reproduce the load test

The k6 script is `loadtest/post.js`. It posts transfers between 1,000 seeded accounts at a constant arrival rate. k6 runs from the `grafana/k6` Docker image; nothing is installed globally.

```sh
pnpm build
loadtest/run.sh 500        # writes loadtest/reports/local-<date>-500.json
```

`run.sh` does, in order: starts the database, empties the ledger, seeds 1,000 accounts (`pnpm db:seed`), starts `pnpm start`, waits for `/v1/health`, runs k6 for 60 seconds, stops the server. Each run starts from the same empty state with a cold connection pool. It needs `.env.local` (or the environment) to hold `LEDGER_API_KEY` and `LEDGER_API_KEY_SHA256`, and a local app database URL. It refuses to run against a non-local database, because it truncates the ledger.

The thresholds in the script are zero failed requests, zero dropped iterations and p99 under 100 ms. Reports and the environment they were taken in are in [`loadtest/reports/`](loadtest/reports); the write-up page at `/` reads its figures from those JSON files.

### Against the deployment

`loadtest/run-live.sh` runs the same script against a deployed ledger and needs only the write key. Each run creates 200 accounts through `POST /v1/accounts`, warms up for 30 seconds at 10 requests per second (excluded from the figures), then measures 60 seconds at each rate you pass, and stops at the first rate that crosses a threshold. The default p99 threshold is 250 ms (`P99_MS`); it counts the network path from the client.

```sh
LEDGER_API_KEY=<write key> loadtest/run-live.sh 25 50 100 200   # writes loadtest/reports/live-<date>-<rps>.json
```

The test accounts and transactions stay in the demo ledger until the nightly reset.

A local run measures this code on one machine. It does not predict a hosted deployment, and the report says which environment it was taken in.

## Deploy

One Vercel project. `vercel.json` schedules `/api/cron/reset` nightly. The reset empties the demo ledger through an owner-defined SQL function and loads 50 accounts and 500 transactions with one multi-row insert per table, in a single transaction.

1. Migrate with the **unpooled owner** URL: `MIGRATE_DATABASE_URL=<unpooled owner url> pnpm db:migrate`. The migrations create the `ledger_app` role without a password and set its `statement_timeout` (5s) and `idle_in_transaction_session_timeout` (10s).
2. Set the role's password out of band, as the owner, in a SQL session. Do not commit it or put it in a migration: `alter role ledger_app password '<generated secret>';`
3. In Vercel, set `LEDGER_DATABASE_URL` to the `ledger_app` **pooled** URL, plus `LEDGER_API_KEY_SHA256` and `CRON_SECRET`. Leave the integration's `DATABASE_URL` alone.
4. Add a Vercel Firewall rate limit for `POST /v1/*`.

When the host contains `-pooler` the driver turns off prepared statements, because PgBouncer in transaction mode cannot be assumed to keep them. Direct hosts keep them.

### Region

`vercel.json` pins functions to `iad1`, next to the Neon project, whose `PGHOST` carries `us-east-1` (`ep-...-pooler.c-15.us-east-1.aws.neon.tech`). Mapping used, AWS region to Vercel region:

| Neon region | Vercel region |
|---|---|
| `aws-us-east-1` | `iad1` |
| `aws-us-east-2` | `cle1` |
| `aws-us-west-2` | `pdx1` |
| `aws-eu-central-1` | `fra1` |
| `aws-eu-west-2` | `lhr1` |
| `aws-ap-southeast-1` | `sin1` |
| `aws-ap-southeast-2` | `syd1` |

Change `regions` if the Neon project moves.

## Layout

| Path | Role |
|---|---|
| `src/ledger/` | Domain and `LedgerService`: accounts, transactions, entries. Owns the tables. |
| `src/http/`, `src/app/v1/` | Route handlers. zod parses input; `http/errors.ts` maps errors to status codes once. |
| `src/auth/` | Bearer key check, constant time. |
| `src/surface/`, `src/app/` | Server-rendered write-up and explorer. Read through `LedgerService`, never SQL. |
| `db/migrations/` | Plain SQL, applied by `scripts/migrate.ts`. |
| `loadtest/` | k6 script, runner and published reports. |
