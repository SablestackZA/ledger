import { unstable_cache } from "next/cache";
import { getLedger } from "../server/container";
import type { Integrity } from "../ledger/types";
import { hasEnvironmentNote, loadRuns, schemaExcerpt, type Run } from "../surface/reports";
import { Code, Empty, Figure, Footer, Frame, Nav, REPO, Section, Status } from "../surface/ui";

export const dynamic = "force-dynamic";

// Rounded half-up to 0.01; k6's console truncates, so the last digit can differ by 0.01.
const round2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const num = (v: number | null) => (v === null ? "n/a" : round2(v));
const ms = (v: number | null) => (v === null ? "n/a" : round2(v));
const int = (v: number | null) => (v === null ? "n/a" : v.toLocaleString("en-US"));

// O(entries); one result is shared for 30 seconds across requests.
const cachedIntegrity = unstable_cache(() => getLedger().checkIntegrity(), ["integrity"], { revalidate: 30 });

async function readIntegrity(): Promise<Integrity | null> {
  try {
    return await cachedIntegrity();
  } catch {
    return null;
  }
}

const POSTING_PATH = `begin                                   read committed

1  insert into transactions (...)
     on conflict (idempotency_key) do nothing
2  select id, currency from accounts
     where id in (...) order by id for update
   application: compare each entry currency with its account
3  insert into entries (...)
4  update accounts
     set balance_minor = balance_minor + delta,
         version = version + 1

commit                                  deferred trigger: at least 2 entries,
                                        sum = 0 per currency`;

const REPRODUCE = `pnpm install
pnpm db:up && pnpm db:migrate
cp .env.example .env.local    # set LEDGER_API_KEY and LEDGER_API_KEY_SHA256, see README
pnpm build
loadtest/run.sh 500           # reset, seed 1,000 accounts, start the app, run k6 in Docker`;

const ENDPOINTS: [string, string, string][] = [
  ["POST", "/v1/accounts", "key"],
  ["GET", "/v1/accounts", "public"],
  ["GET", "/v1/accounts/{id}", "public"],
  ["GET", "/v1/accounts/{id}/entries", "public"],
  ["POST", "/v1/transactions", "key"],
  ["GET", "/v1/transactions", "public"],
  ["GET", "/v1/transactions/{id}", "public"],
  ["POST", "/v1/transactions/{id}/reversals", "key"],
  ["GET", "/v1/integrity", "public"],
  ["GET", "/v1/health", "public"],
];

export default async function WriteUp() {
  const integrity = await readIntegrity();
  const runs = loadRuns("local");
  const schema = schemaExcerpt();

  return (
    <>
      <Nav current="writeup" />
      <main className="sbl-page">
        <section className="sbl-hero">
          <p className="sbl-label">Sablestack Ledger</p>
          <h1 className="sbl-display">
            A double-entry ledger <span className="sbl-soft">that checks its own balance.</span>
          </h1>
          <p className="sbl-lede">
            An HTTP API for accounts and transactions. Every transaction sums to zero. Every cached balance equals the sum of its entries. The check is a public endpoint.
          </p>
          <div className="sbl-actions">
            <a className="sbl-btn sbl-btn--solid" href="/accounts">Open the explorer <span aria-hidden="true">→</span></a>
            <a className="sbl-btn sbl-btn--outline" href="/v1/integrity">Run the integrity check</a>
          </div>
        </section>

        <Section eyebrow="Live status" title="Integrity" lede="The check reads every entry on the demo ledger. This page shows a result that is at most 30 seconds old.">
          <Frame>
            {integrity ? (
              <div style={{ display: "grid", gap: 24 }}>
                <Status kind={integrity.ok ? "live" : "failed"} accent={!integrity.ok}>{integrity.ok ? "Balanced" : "Drift detected"}</Status>
                <div className="sbl-stats">
                  <Stat label="Accounts" value={int(integrity.accounts)} />
                  <Stat label="Transactions" value={int(integrity.transactions)} />
                  <Stat label="Entries" value={int(integrity.entries)} />
                  <Stat label="Unbalanced transactions" value={int(integrity.unbalanced_transactions)} />
                  <Stat label="Drifted accounts" value={int(integrity.drifted_accounts)} />
                  <Stat label="Transactions under 2 entries" value={int(integrity.transactions_under_two_entries)} />
                </div>
                <p className="sbl-label">
                  Checked <span className="sbl-mono">{integrity.checked_at}</span>. The demo ledger is emptied and reseeded every night.
                </p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <Status kind="degraded">Unavailable</Status>
                <p className="sbl-lede">The database did not answer. Reload in a few seconds.</p>
              </div>
            )}
          </Frame>
        </Section>

        <Section eyebrow="The problem" title="A balance must equal the movements behind it">
          <div className="sbl-prose">
            <p>
              A balance is a number that has to equal the sum of the entries posted to the account. Systems that update the balance and the entries as separate steps drift apart under failure and concurrency, and nobody sees it until an audit.
            </p>
            <p>
              Here the entries and the balance change in one database transaction, so a reader never sees one without the other. Postings take row locks in a fixed order, so concurrent writers queue instead of deadlocking. Postgres triggers reject an unbalanced set of entries even if the application is wrong.
            </p>
            <p>
              Money is stored as 64-bit integers in minor units with an ISO 4217 currency. Writes need an API key and an idempotency key. Reads are public.
            </p>
          </div>
        </Section>

        <Section eyebrow="Schema" title="Three tables" lede="Entries are append-only. The application database role has no UPDATE or DELETE grant on them.">
          {schema ? (
            <Figure n={1} caption="Accounts, transactions and entries, quoted from the migration." source={[{ label: "db/migrations/0001_init.sql", path: "db/migrations/0001_init.sql" }]}>
              <Code name="sql">{schema}</Code>
            </Figure>
          ) : null}
        </Section>

        <Section eyebrow="Posting path" title="One database transaction" lede="Posting a transaction is four statements between begin and commit, plus a currency check in the application. The deferred trigger runs at commit.">
          <Figure n={2} caption="The posting path in READ COMMITTED, as implemented in the ledger service." source={[{ label: "src/ledger/service.ts", path: "src/ledger/service.ts" }]}>
            <Code name="posting path">{POSTING_PATH}</Code>
          </Figure>
          <div className="sbl-prose">
            <p>
              A repeated Idempotency-Key with the same body returns the original transaction with 200. The same key with a different body returns 409. A reversal posts the negated entries and marks the original reversed in the same transaction; a second reversal returns 409.
            </p>
          </div>
        </Section>

        <Section
          eyebrow="Load test"
          title="Posting under constant arrival rate"
          lede="k6 posts transfers between 1,000 seeded accounts at a fixed rate for 60 seconds per run. The environment is stated with every figure."
        >
          {runs.length === 0 ? (
            <Empty title="No reports published yet" body="The report files are committed under loadtest/reports. None were found in this build." action={{ href: `${REPO}/tree/main/loadtest`, label: "Open loadtest" }} />
          ) : (
            <LoadFigures runs={runs} />
          )}
          <div className="sbl-prose">
            <p>
              These runs are local: the app, Postgres 17 in Docker and the k6 container shared one laptop. They show how the code behaves on that machine, not what a hosted deployment will do. A second report against the Vercel deployment, with its Neon tier named, has not been run.
            </p>
            {hasEnvironmentNote() ? (
              <p>
                Machine, versions, pool size and exact commands:{" "}
                <a className="sbl-underline sbl-mono" href={`${REPO}/blob/main/loadtest/reports/environment.md`}>loadtest/reports/environment.md</a>.
              </p>
            ) : null}
          </div>
        </Section>

        <Section eyebrow="Reproduce" title="Run it yourself" lede="Docker, Node 24, pnpm 9. No account on any service.">
          <Code name="shell">{REPRODUCE}</Code>
        </Section>

        <Section eyebrow="API" title="Ten endpoints" lede="Base path /v1. Errors are { error: { code, message, details } }. Lists use cursor pagination.">
          <div className="sbl-table-wrap">
            <table className="sbl-table">
              <thead>
                <tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">Auth</th></tr>
              </thead>
              <tbody>
                {ENDPOINTS.map(([method, path, auth]) => (
                  <tr key={`${method} ${path}`}>
                    <td className="sbl-mono">{method}</td>
                    <td className="sbl-mono">{path}</td>
                    <td className="sbl-soft">{auth === "key" ? "Bearer key" : "Public"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </main>
      <Footer />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sbl-stat">
      <span className="sbl-stat-label">{label}</span>
      <span className="sbl-stat-value">{value}</span>
    </div>
  );
}

function LoadFigures({ runs }: { runs: Run[] }) {
  const source = runs.map((r) => ({ label: r.path.replace("loadtest/reports/", ""), path: r.path }));
  return (
    <>
      <Figure n={3} caption="Response time of POST /v1/transactions by target rate, in milliseconds rounded to 0.01. Local runs." source={source}>
        <div className="sbl-table-wrap">
          <table className="sbl-table">
            <thead>
              <tr>
                <th scope="col">Run date</th>
                <th scope="col" className="sbl-num">Target req/s</th>
                <th scope="col" className="sbl-num">p50 (ms)</th>
                <th scope="col" className="sbl-num">p95 (ms)</th>
                <th scope="col" className="sbl-num">p99 (ms)</th>
                <th scope="col" className="sbl-num">Max (ms)</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.path}>
                  <td className="sbl-mono sbl-soft">{r.date}</td>
                  <td className="sbl-num">{r.targetRps}</td>
                  <td className="sbl-num">{ms(r.p50)}</td>
                  <td className="sbl-num">{ms(r.p95)}</td>
                  <td className="sbl-num">{ms(r.p99)}</td>
                  <td className="sbl-num">{ms(r.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Figure>
      <Figure n={4} caption="Requests completed, achieved rate, failed requests and dropped iterations for the same runs. Rates are rounded to 0.01." source={source}>
        <div className="sbl-table-wrap">
          <table className="sbl-table">
            <thead>
              <tr>
                <th scope="col">Run date</th>
                <th scope="col" className="sbl-num">Target req/s</th>
                <th scope="col" className="sbl-num">Requests</th>
                <th scope="col" className="sbl-num">Achieved req/s</th>
                <th scope="col" className="sbl-num">Failed rate</th>
                <th scope="col" className="sbl-num">Dropped</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.path}>
                  <td className="sbl-mono sbl-soft">{r.date}</td>
                  <td className="sbl-num">{r.targetRps}</td>
                  <td className="sbl-num">{int(r.requests)}</td>
                  <td className="sbl-num">{num(r.achievedRps)}</td>
                  <td className="sbl-num">{r.errorRate === null ? "n/a" : `${round2(r.errorRate * 100)}%`}</td>
                  <td className="sbl-num">{int(r.dropped)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Figure>
    </>
  );
}
