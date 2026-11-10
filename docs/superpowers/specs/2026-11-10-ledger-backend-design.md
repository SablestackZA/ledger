# Sablestack Ledger: design

Status: approved by lead 2026-11-10 · Linear INV-2874 (studio work, piece 1)

## Intent

The first piece of studio work for sablestack.io. It is a double-entry ledger API, built in-house and labelled that way, with a small surface and a published load-test report. It exists to prove schema → service → surface, and to produce real numbers that anyone can check:

1. **Live integrity.** `GET /v1/integrity` proves on demand that every transaction balances and every cached balance equals the sum of its entries.
2. **Reproducible load test.** The k6 script, the environment and the raw summary JSON are all in the public repo. Anyone can rerun them with `docker compose up` plus `k6 run`.

Owner decisions: the ledger is the first piece; it is hosted on a Vercel subdomain (`ledger.sablestack.io`) from a public repo, `SablestackZA/ledger`.

Goals: the posting path is correct under concurrency, idempotent, and has published p50/p95/p99 figures. The write-up page carries "Fig. n" captions in the site's design system.

Non-goals: multi-currency conversion, an FX engine, user accounts, a billing UI, webhooks.

Anti-goals: any number in the write-up without a report file behind it; any suggestion that a client runs this.

## 1. Pushback

- **Public writes.** A publicly writable database invites abuse and costs money. Writes require a bearer API key that the owner holds. The public surface is read-only over a demo ledger. Reproducibility comes from the local docker path, not from open writes.
- **A live load test against free-tier Neon** would measure the database tier, not the code. Two reports are published, each with its environment stated: `local` (a stated machine with Postgres 17 in Docker) and `live` (the Vercel deployment with its Neon tier named). Neither number is presented without its environment.

## 2. Modules

One deployable: a Next.js 16 app with route handlers. Dependencies point one way.

- `ledger` (domain + service): accounts and transactions. It exports `LedgerService`, whose methods are `openAccount`, `postTransaction`, `reverseTransaction`, `getAccount`, `listAccounts`, `getTransaction`, `listTransactions` and `checkIntegrity`. It owns the tables `accounts`, `transactions` and `entries`.
- `http` (edge): route handlers under `app/v1/**`. They parse DTOs with zod, call `LedgerService`, and map domain errors to status codes once, in `http/errors.ts`.
- `auth` (edge): verifies the bearer key against `LEDGER_API_KEY_SHA256`, comparing in constant time.
- `surface`: server components that read through `LedgerService`, never through SQL.

## 3. Data model

All money is `bigint` minor units with an ISO 4217 `currency char(3)`. All times are `timestamptz` UTC. Public ids are UUIDv7.

- `accounts`: `id uuid pk`, `code text unique`, `name text`, `type account_type` (asset | liability | equity | income | expense), `currency char(3)`, `balance_minor bigint not null default 0`, `version int not null default 0`, `created_at`.
  - The balance is signed: debit positive, credit negative. Normal-side presentation is done at the edge.
- `transactions`: `id uuid pk`, `idempotency_key text unique not null`, `request_hash bytea not null`, `description text`, `status txn_status` (posted | reversed), `reverses_id uuid null references transactions`, `version int`, `posted_at`.
- `entries`: `id bigserial pk` (internal), `transaction_id uuid fk`, `account_id uuid fk`, `amount_minor bigint not null check (amount_minor <> 0)`, `currency char(3)`. Entries are immutable: no UPDATE or DELETE grants are given to the app role.

Aggregate: a transaction plus its entries. It is immutable once posted; it is corrected only by reversal.

Departs from default: `accounts.balance_minor` is updated in the same database transaction as the entries, so one transaction touches two aggregates. The balance is a cache derived from entries, and the product's central promise is that it is never stale. A deferred update through an outbox would make `/v1/integrity` fail by design.

DB-level backstops:
- A deferred constraint trigger on `entries` asserts that `sum(amount_minor) = 0` per `(transaction_id, currency)` and that there are at least 2 entries.
- A trigger asserts that each entry's currency equals its account's currency.

## 4. State machines

`transactions.status`:

| From | To | Trigger | Checks | Effects |
|---|---|---|---|---|
| (none) | posted | `postTransaction` | ≥2 entries, sum 0 per currency, accounts exist and match currency, idempotency key unused or same hash | balances updated |
| posted | reversed | `reverseTransaction` | status = posted (conditional update on version); the original is not itself a reversal | a new posted transaction with negated entries, `reverses_id` set |
| reversed | any | none | none | 409 with current state |

Accounts have no lifecycle (no close) in v1.

## 5. Ports and adapters

- `Db` port: `withTransaction(fn)` and a query interface.
  - Real adapter: `postgres` (porsager) driver, pooled. Neon pooled URL in production.
  - Fake: none. Tests run against real Postgres via docker compose, because the invariants live partly in SQL triggers and an in-memory fake would test the wrong thing.
  - Timeout: `statement_timeout = 5s` and `idle_in_transaction_session_timeout = 10s`, set per connection.
- `Clock` port: `now()`. The fake is a fixed clock in unit tests.
- No third parties.

Departs from default: there is no fake DB adapter. Correctness depends on Postgres locking and triggers.

## 6. Transactions and effects

- `postTransaction`, in one DB transaction (READ COMMITTED):
  1. Insert the transaction row. `ON CONFLICT (idempotency_key)` handles replays (see §7).
  2. `SELECT … FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE`. Locks are taken in id order to avoid deadlocks.
  3. Validate currencies.
  4. Insert the entries.
  5. `UPDATE accounts SET balance_minor = balance_minor + delta, version = version + 1` per account.
  6. Commit. The deferred trigger fires at commit.
- `reverseTransaction`: conditional update `status = 'reversed' WHERE id = $1 AND status = 'posted' AND version = $v`, then the same posting path for the negated entries, all in one transaction.
- Effects: none. There is no outbox, because nothing leaves the system.

Departs from default: pessimistic row locks (ordered) instead of optimistic version checks for balance updates. Hot accounts take concurrent postings by design, and optimistic retry would turn contention into 409s that the client would have to retry.

## 7. Idempotency

- `POST /v1/transactions` and `POST /v1/accounts` require an `Idempotency-Key` header (1 to 128 chars).
  - The key is stored with the SHA-256 of the canonical request body.
  - Same key and same hash: return the original resource with `200` and `Idempotent-Replayed: true`.
  - Same key, different hash: `409 idempotency_conflict`.
- `POST /v1/transactions/{id}/reversals`: idempotent by state. A repeat returns 409 with the current state and `reversed_by` id.

## 8. Failure modes

| Failure | Detection | System does | Caller sees |
|---|---|---|---|
| Unbalanced entries | service validation; deferred trigger as backstop | reject, nothing written | 422 `unbalanced` with per-currency sums |
| Currency mismatch | service; trigger | reject | 422 `currency_mismatch` |
| Unknown account | lock query returns fewer rows | reject | 422 `unknown_account` |
| Concurrent posts to one account | row lock | serialise | higher latency, no error |
| Deadlock | prevented by ordered locking; `40P01` mapped if seen | retry once, then 503 | 503 `retry` |
| Replay with same key | unique conflict | return original | 200 + `Idempotent-Replayed` |
| DB slow / down | `statement_timeout`, connect timeout 3s | abort | 503 `unavailable` |
| Pool exhausted under load | driver queue timeout | abort | 503; counted in load report |
| Neon cold start | first query latency | none | the live report states whether warm-up was excluded |
| Integrity check finds drift | `/v1/integrity` returns `ok:false` | none (alert only) | the public page shows red status; this must never happen |

## 9. API surface

JSON over HTTPS, base `/v1`. Errors use `{ error: { code, message, details? } }`. Lists use cursor pagination (`?limit≤100&cursor=`, response `{ data, next_cursor }`).

| Method | Path | DTO in / out | Codes | Auth |
|---|---|---|---|---|
| POST | /v1/accounts | `OpenAccount` / `Account` | 201, 200 replay, 409, 422 | key |
| GET | /v1/accounts | none / `Page<Account>` | 200 | public (demo ledger) |
| GET | /v1/accounts/{id} | none / `Account` | 200, 404 | public |
| GET | /v1/accounts/{id}/entries | none / `Page<Entry>` | 200, 404 | public |
| POST | /v1/transactions | `PostTransaction` / `Transaction` | 201, 200 replay, 409, 422 | key |
| GET | /v1/transactions | none / `Page<Transaction>` | 200 | public |
| GET | /v1/transactions/{id} | none / `Transaction` (with entries) | 200, 404 | public |
| POST | /v1/transactions/{id}/reversals | none / `Transaction` | 201, 404, 409 | key |
| GET | /v1/integrity | none / `Integrity` | 200 | public |
| GET | /v1/health | none / `{ok}` | 200, 503 | public |

`PostTransaction`: `{ description?: string≤200, entries: [{ account_id, amount_minor: string|int, currency }] (2..50) }`. `amount_minor` is serialised as a string in responses, because it is a bigint.

## 10. Reads and reports

- Account entries: index `entries (account_id, id desc)`.
- Transaction list: index `transactions (posted_at desc, id desc)`.
- Integrity runs two queries:
  1. `select count(*) from (select transaction_id, currency from entries group by 1,2 having sum(amount_minor) <> 0)`.
  2. `select count(*) from accounts a where balance_minor <> coalesce((select sum(amount_minor) from entries e where e.account_id = a.id),0)`.
- Integrity is O(entries). The live demo is capped at 1M entries by a nightly reset (see §15). A read model is justified only past that.

## 11. Security

- Writes need `Authorization: Bearer <key>`. The key is compared by SHA-256 in constant time.
- Reads are public and scoped to the single demo ledger.
- The app DB role has no UPDATE/DELETE on `entries` and no DDL.
- Never logged: the API key, full request bodies. Logged: method, path, status, duration, idempotency key hash prefix, correlation id.
- Rate limiting: a Vercel Firewall rule on `/v1/*` POST (owner-applied; it is a live mutation).

## 12. Observability

- A correlation id comes from `x-request-id` or is generated, echoed in the response, and included in every log line.
- Metrics, as structured logs:
  1. Postings per second.
  2. Failures by error code.
  3. p99 of the posting transaction duration.
- There is no outbox, so there is no outbox-age metric.

## 13. Testing

- **Unit:** validation (balanced, ≥2 entries, currency) through a fixed clock.
- **Integration**, through HTTP to real Postgres (docker compose, `pnpm test`):
  - one test per endpoint;
  - idempotent replay and conflict;
  - reversal twice → 409;
  - unbalanced → 422;
  - trigger backstop: a raw insert of an unbalanced set fails at commit.
- **Concurrency:** 200 parallel transfers between 3 accounts, then the integrity check is ok and the balances equal the expected sums.
- **Load:** `loadtest/post.js` (k6). The `constant-arrival-rate` scenario posts transfers between 1,000 seeded accounts. Summary JSON goes to `loadtest/reports/<env>-<date>.json`, with `environment.md` beside it.

## 14. Rejected alternatives

- **Event sourcing:** the entries table already is the event log; a second log adds nothing.
- **CQRS / read model:** the reads are indexed lookups.
- **A queue for postings:** it would make posting asynchronous and break the read-your-write guarantee that integrity depends on.
- **Optimistic locking on balances:** it would turn hot-account contention into client retries (see §6).
- **ORM (Drizzle/Prisma):** the critical path is three hand-written statements plus triggers. Plain SQL migrations keep that visible in the write-up.
- **Separate API and web deployables:** one Vercel project is enough.

## 15. Open questions

- Neon tier for the live report. Assumption: the Vercel Marketplace free tier. The report names it.
- Demo data reset. Assumption: a nightly Vercel Cron job (`/api/cron/reset`, guarded by `CRON_SECRET`) truncates and reseeds 50 accounts and 500 transactions.
- Custom domain `ledger.sablestack.io`. Assumption: DNS is added by the owner at production time. Previews use the vercel.app URL.

## Surface (frontend, small)

These are server-rendered pages in the Sablestack design system: tokens and fonts copied from the website, dark default, hairlines, pills, no shadows or gradients.

- `/`: the write-up. It covers the problem, the schema (Fig. 1), the posting path (Fig. 2), the load-test results (Fig. 3 and 4, each with a source link to the report file in the repo) and live integrity status. Footer: "Built in-house by Sablestack (Pty) Ltd."
- `/accounts` and `/transactions/[id]`: a read-only explorer of the demo ledger. Amounts are in mono, with signs shown on the normal side.

Pattern: none beyond the defaults for the ledger service, because it is three commands over one aggregate; rejected repository/unit-of-work classes; revisit when a second deployable consumes the domain.
