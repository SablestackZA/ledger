// POST /v1/transactions at a constant arrival rate. run.sh drives local mode (accounts from `pnpm db:seed`);
// run-live.sh sets MODE=live, where setup() creates its own accounts through the API.
import http from "k6/http";
import { check, fail } from "k6";
import { Counter, Trend } from "k6/metrics";

const LIVE = __ENV.MODE === "live";
const BASE = __ENV.BASE_URL || "http://localhost:3000";
const KEY = __ENV.LEDGER_API_KEY;
const RATE = Number(__ENV.RATE || 250);
const DURATION = __ENV.DURATION || "60s";
const P99_MS = Number(__ENV.P99_MS || 100);
const ACCOUNTS = Number(__ENV.ACCOUNTS || 200);
const WARMUP = __ENV.WARMUP || "30s";
const WARMUP_RATE = Number(__ENV.WARMUP_RATE || 10);
// Keeps idempotency keys and account codes unique across runs against the same database.
const RUN = __ENV.RUN_ID || String(Date.now());

// Server-side time from the Server-Timing header (db: posting transaction, app: whole handler), measured scenario only.
const serverDb = new Trend("server_db", true);
const serverApp = new Trend("server_app", true);
// An empty trend passes any threshold, so a response without the header must fail the run instead.
const missingTiming = new Counter("server_timing_missing");

const measureScenario = {
  executor: "constant-arrival-rate",
  exec: "measure",
  rate: RATE,
  timeUnit: "1s",
  duration: DURATION,
  // ~300 ms live round trips need ~0.3 x rate VUs; VUs created mid-run delay iterations, which k6 counts as dropped.
  preAllocatedVUs: LIVE ? Math.max(50, Math.ceil(RATE * 0.8)) : Math.max(50, Math.ceil(RATE / 4)),
  maxVUs: Math.max(200, RATE * (LIVE ? 4 : 2)),
};

export const options = {
  scenarios: LIVE
    ? {
        // Tagged endpoint:warmup, so thresholds and exported figures exclude it.
        warmup: { executor: "constant-arrival-rate", exec: "warmup", rate: WARMUP_RATE, timeUnit: "1s", duration: WARMUP, preAllocatedVUs: 10, maxVUs: 50 },
        measure: { ...measureScenario, startTime: WARMUP },
      }
    : { post: measureScenario },
  // Thresholds on POST-only sub-metrics keep setup, warm-up and teardown out; --summary-export carries them.
  thresholds: {
    "http_req_failed{endpoint:post_transactions}": ["rate==0"],
    // Live: client latency includes the network path from the test machine, so it is exported but
    // not judged (max>=0 always holds; k6 only exports a sub-metric that has a threshold). The server-side p99 is.
    "http_req_duration{endpoint:post_transactions}": [LIVE ? "max>=0" : `p(99)<${P99_MS}`],
    ...(LIVE ? { server_app: [`p(99)<${P99_MS}`], server_db: ["max>=0"], server_timing_missing: ["count==0"] } : {}),
    "http_reqs{endpoint:post_transactions}": ["count>0"],
    // A rate the machine could not sustain shows up as dropped iterations, not as latency.
    [LIVE ? "dropped_iterations{scenario:measure}" : "dropped_iterations"]: ["count==0"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

function writeHeaders(idempotencyKey) {
  return { "content-type": "application/json", authorization: `Bearer ${KEY}`, "idempotency-key": idempotencyKey };
}

function listAccounts() {
  const ids = [];
  let cursor = "";
  do {
    const res = http.get(`${BASE}/v1/accounts?limit=100${cursor ? `&cursor=${cursor}` : ""}`, { tags: { endpoint: "setup" } });
    if (res.status !== 200) fail(`GET /v1/accounts returned ${res.status}`);
    const page = res.json();
    for (const a of page.data) if (a.currency === "ZAR") ids.push(a.id);
    cursor = page.next_cursor;
  } while (cursor);
  return ids;
}

function createAccounts() {
  const ids = [];
  for (let from = 0; from < ACCOUNTS; from += 20) {
    const batch = [];
    for (let i = from; i < Math.min(from + 20, ACCOUNTS); i++) {
      const n = String(i + 1).padStart(4, "0");
      batch.push([
        "POST",
        `${BASE}/v1/accounts`,
        JSON.stringify({ code: `lt-${RUN}-${n}`, name: `Load test ${n}`, type: "asset", currency: "ZAR" }),
        { headers: writeHeaders(`lt-${RUN}-account-${n}`), tags: { endpoint: "setup" } },
      ]);
    }
    for (const res of http.batch(batch)) {
      if (res.status !== 201 && res.status !== 200) fail(`POST /v1/accounts returned ${res.status}`);
      ids.push(res.json("id"));
    }
  }
  return ids;
}

export function setup() {
  if (!KEY) fail("Set LEDGER_API_KEY.");
  const ids = LIVE ? createAccounts() : listAccounts();
  if (ids.length < 2) fail("No accounts to transfer between (local mode: run pnpm db:seed).");
  return { ids };
}

function transfer(data, endpoint) {
  const n = data.ids.length;
  const a = Math.floor(Math.random() * n);
  let b = Math.floor(Math.random() * n);
  if (b === a) b = (b + 1) % n;
  const amount = 1 + Math.floor(Math.random() * 100000);

  const res = http.post(
    `${BASE}/v1/transactions`,
    JSON.stringify({
      description: "load test transfer",
      entries: [
        { account_id: data.ids[b], amount_minor: amount, currency: "ZAR" },
        { account_id: data.ids[a], amount_minor: -amount, currency: "ZAR" },
      ],
    }),
    { headers: writeHeaders(`${RUN}-${__VU}-${__ITER}`), tags: { endpoint } },
  );
  check(res, { "status is 201": (r) => r.status === 201 });
  if (endpoint === "post_transactions") recordServerTiming(res);
}

function recordServerTiming(res) {
  const header = res.headers["Server-Timing"];
  if (!header) {
    missingTiming.add(1);
    return;
  }
  for (const part of header.split(",")) {
    const m = /^\s*(db|app);dur=([\d.]+)/.exec(part);
    if (m) (m[1] === "db" ? serverDb : serverApp).add(Number(m[2]));
  }
}

export function measure(data) {
  transfer(data, "post_transactions");
}

export function warmup(data) {
  transfer(data, "warmup");
}

export function teardown() {
  const res = http.get(`${BASE}/v1/integrity`, { tags: { endpoint: "teardown" } });
  console.log(`integrity after run: ${res.body}`);
}
