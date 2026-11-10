// POST /v1/transactions at a constant arrival rate. Run via loadtest/run.sh; seed with `pnpm db:seed`.
import http from "k6/http";
import { check, fail } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const KEY = __ENV.LEDGER_API_KEY;
const RATE = Number(__ENV.RATE || 250);
const DURATION = __ENV.DURATION || "60s";
// Keeps idempotency keys unique across runs against the same database.
const RUN = __ENV.RUN_ID || String(Date.now());

export const options = {
  scenarios: {
    post: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: Math.max(50, Math.ceil(RATE / 4)),
      maxVUs: Math.max(200, RATE * 2),
    },
  },
  // Thresholds on POST-only sub-metrics keep setup and teardown GETs out; --summary-export carries them.
  thresholds: {
    "http_req_failed{endpoint:post_transactions}": ["rate==0"],
    "http_req_duration{endpoint:post_transactions}": ["p(99)<100"],
    "http_reqs{endpoint:post_transactions}": ["count>0"],
    // A rate the machine could not sustain shows up as dropped iterations, not as latency.
    dropped_iterations: ["count==0"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

export function setup() {
  if (!KEY) fail("Set LEDGER_API_KEY.");
  const ids = [];
  let cursor = "";
  do {
    const res = http.get(`${BASE}/v1/accounts?limit=100${cursor ? `&cursor=${cursor}` : ""}`, { tags: { endpoint: "setup" } });
    if (res.status !== 200) fail(`GET /v1/accounts returned ${res.status}`);
    const page = res.json();
    for (const a of page.data) if (a.currency === "ZAR") ids.push(a.id);
    cursor = page.next_cursor;
  } while (cursor);
  if (ids.length < 2) fail("Seed accounts first (pnpm db:seed).");
  return { ids };
}

export default function post(data) {
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
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${KEY}`,
        "idempotency-key": `${RUN}-${__VU}-${__ITER}`,
      },
      tags: { endpoint: "post_transactions" },
    },
  );
  check(res, { "status is 201": (r) => r.status === 201 });
}

export function teardown() {
  const res = http.get(`${BASE}/v1/integrity`, { tags: { endpoint: "teardown" } });
  console.log(`integrity after run: ${res.body}`);
}
