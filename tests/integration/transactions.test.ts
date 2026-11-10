import { describe, expect, it, vi } from "vitest";
import { GET as getAccount } from "../../src/app/v1/accounts/[id]/route";
import { GET as getTransaction } from "../../src/app/v1/transactions/[id]/route";
import { GET as listTransactions, POST as postTransaction } from "../../src/app/v1/transactions/route";
import { call, owner, cleanDatabase } from "../support/harness";
import { TEST_API_KEY } from "../support/constants";
import { openAccount, transfer } from "../support/fixtures";

cleanDatabase();

const balance = async (id: string) => (await call(getAccount, "", { params: { id } })).body.balance_minor;
const post = (o: Parameters<typeof call>[2]) => call(postTransaction, "/v1/transactions", { method: "POST", ...o });
const count = async (table: "transactions" | "entries") =>
  (await owner.unsafe<{ n: string }[]>(`select count(*) as n from ${table}`))[0]!.n;

describe("POST /v1/transactions", () => {
  it("posts a balanced transfer and updates both balances", async () => {
    const cash = await openAccount("cash");
    const rev = await openAccount("revenue", "ZAR", "income");
    const res = await transfer(rev.id, cash.id, 12_500, "k1");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "posted", reverses_id: null, reversed_by: null, description: "test transfer" });
    expect(res.body.entries).toEqual([
      { account_id: cash.id, amount_minor: "12500", currency: "ZAR" },
      { account_id: rev.id, amount_minor: "-12500", currency: "ZAR" },
    ]);
    expect(await balance(cash.id)).toBe("12500");
    expect(await balance(rev.id)).toBe("-12500");
  });

  it("treats 5 and \"5\" as the same request", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    const mk = (amt: number | string) =>
      post({
        auth: true,
        key: "k1",
        body: { entries: [{ account_id: a.id, amount_minor: amt, currency: "ZAR" }, { account_id: b.id, amount_minor: `-${amt}`, currency: "ZAR" }] },
      });
    expect((await mk(5)).status).toBe(201);
    expect((await mk("5")).status).toBe(200);
  });

  it("replays the same key and body: 200, Idempotent-Replayed, balances applied once", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    const first = await transfer(a.id, b.id, 700, "k1");
    const again = await transfer(a.id, b.id, 700, "k1");
    expect(again.status).toBe(200);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body).toEqual(first.body);
    expect(await balance(b.id)).toBe("700");
  });

  it("returns 409 idempotency_conflict for the same key with a different body", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    await transfer(a.id, b.id, 700, "k1");
    const res = await transfer(a.id, b.id, 701, "k1");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("idempotency_conflict");
    expect(await balance(b.id)).toBe("700");
  });

  it("collapses simultaneous requests with one key into a single posting", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    const results = await Promise.all(Array.from({ length: 20 }, () => transfer(a.id, b.id, 50, "same")));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(19);
    expect(await balance(b.id)).toBe("50");
    expect(await count("transactions")).toBe("1");
  });

  it("rejects unbalanced entries with 422 and the sums, writing nothing", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    const res = await post({
      auth: true,
      key: "k1",
      body: { entries: [{ account_id: a.id, amount_minor: 100, currency: "ZAR" }, { account_id: b.id, amount_minor: -90, currency: "ZAR" }] },
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "unbalanced", details: { sums: { ZAR: "10" } } });
    expect(await count("transactions")).toBe("0");
  });

  it("rejects an unknown account with 422 and rolls the transaction row back", async () => {
    const a = await openAccount("a");
    const ghost = "018f0000-0000-7000-8000-0000000000ff";
    const res = await transfer(a.id, ghost, 100, "k1");
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "unknown_account", details: { account_ids: [ghost] } });
    expect(await count("transactions")).toBe("0");
  });

  it("rejects an entry whose currency differs from its account with 422", async () => {
    const zar = await openAccount("zar", "ZAR");
    const usd = await openAccount("usd", "USD");
    const res = await post({
      auth: true,
      key: "k1",
      body: { entries: [{ account_id: zar.id, amount_minor: 100, currency: "ZAR" }, { account_id: usd.id, amount_minor: -100, currency: "ZAR" }] },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("currency_mismatch");
    expect(await count("transactions")).toBe("0");
  });

  it("rejects fewer than 2 entries, a zero amount and an unknown field with 422", async () => {
    const a = await openAccount("a");
    const one = await post({ auth: true, key: "k1", body: { entries: [{ account_id: a.id, amount_minor: 1, currency: "ZAR" }] } });
    expect(one.status).toBe(422);
    const zero = await post({
      auth: true,
      key: "k2",
      body: { entries: [{ account_id: a.id, amount_minor: 0, currency: "ZAR" }, { account_id: a.id, amount_minor: 0, currency: "ZAR" }] },
    });
    expect(zero.status).toBe(422);
    const extra = await post({ auth: true, key: "k3", body: { entries: [], surprise: true } });
    expect(extra.status).toBe(422);
  });

  it("requires the bearer key and an Idempotency-Key", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    const body = { entries: [{ account_id: a.id, amount_minor: 1, currency: "ZAR" }, { account_id: b.id, amount_minor: -1, currency: "ZAR" }] };
    expect((await post({ key: "k1", body })).status).toBe(401);
    expect((await post({ auth: true, body })).status).toBe(422);
  });

  it("reports a balance that would leave the 64-bit range as 422", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    const big = "9223372036854775807";
    expect((await transfer(a.id, b.id, big, "k1")).status).toBe(201);
    const res = await transfer(a.id, b.id, big, "k2");
    expect(res.status).toBe(422);
    expect(await count("transactions")).toBe("1");
  });
});

describe("GET /v1/transactions/{id}", () => {
  it("returns the transaction with its entries", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    const posted = await transfer(a.id, b.id, 100, "k1");
    const res = await call(getTransaction, "", { params: { id: posted.body.id } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(posted.body);
  });
  it("returns 404 for unknown and malformed ids", async () => {
    for (const id of ["018f0000-0000-7000-8000-0000000000ff", "nope"]) {
      expect((await call(getTransaction, "", { params: { id } })).status).toBe(404);
    }
  });
});

describe("GET /v1/transactions", () => {
  it("pages newest first by (posted_at, id) with entries attached", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await transfer(a.id, b.id, 10 + i, `k${i}`)).body.id);
    const p1 = await call(listTransactions, "/v1/transactions", { query: "?limit=2" });
    expect(p1.status).toBe(200);
    expect(p1.body.data.map((t: { id: string }) => t.id)).toEqual([ids[4], ids[3]]);
    expect(p1.body.data[0].entries).toHaveLength(2);
    const p2 = await call(listTransactions, "/v1/transactions", { query: `?limit=2&cursor=${p1.body.next_cursor}` });
    expect(p2.body.data.map((t: { id: string }) => t.id)).toEqual([ids[2], ids[1]]);
    const p3 = await call(listTransactions, "/v1/transactions", { query: `?limit=2&cursor=${p2.body.next_cursor}` });
    expect(p3.body.data.map((t: { id: string }) => t.id)).toEqual([ids[0]]);
    expect(p3.body.next_cursor).toBeNull();
  });
  it("returns an empty page on an empty ledger", async () => {
    const res = await call(listTransactions, "/v1/transactions");
    expect(res.body).toEqual({ data: [], next_cursor: null });
  });
});

describe("GET /v1/transactions cursor validation", () => {
  const enc = (raw: string) => Buffer.from(raw, "utf8").toString("base64url");
  const id = "018f0000-0000-7000-8000-0000000000a1";
  it.each([
    ["not a timestamp", `yesterday|${id}`],
    ["month 13", `2026-13-10T00:00:00.000Z|${id}`],
    ["a day that does not exist", `2026-02-31T00:00:00.000Z|${id}`],
    ["no milliseconds", `2026-11-10T00:00:00Z|${id}`],
    ["an offset instead of Z", `2026-11-10T00:00:00.000+02:00|${id}`],
    ["a bad id", "2026-11-10T00:00:00.000Z|nope"],
    ["a missing id", "2026-11-10T00:00:00.000Z"],
  ])("returns 422 for %s", async (_name, raw) => {
    const res = await call(listTransactions, "/v1/transactions", { query: `?cursor=${enc(raw)}` });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("invalid_request");
  });
});

describe("Server-Timing", () => {
  const parse = (h: string | null) => Object.fromEntries((h ?? "").split(", ").map((p) => [p.split(";")[0], Number(p.split("dur=")[1])]));

  it("reports db and app milliseconds on a posting, with db inside app", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    const res = await transfer(a.id, b.id, 100, "k1");
    expect(res.headers.get("server-timing")).toMatch(/^db;dur=\d+(\.\d+)?, app;dur=\d+(\.\d+)?$/);
    const t = parse(res.headers.get("server-timing"));
    expect(t.db).toBeGreaterThan(0);
    expect(t.app).toBeGreaterThanOrEqual(t.db!);
  });

  it("includes db on a replay and only app on a rejected request", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    await transfer(a.id, b.id, 100, "k1");
    const replay = await transfer(a.id, b.id, 100, "k1");
    expect(parse(replay.headers.get("server-timing")).db).toBeGreaterThan(0);
    const bad = await post({ auth: true, key: "k2", body: { entries: [] } });
    expect(bad.status).toBe(422);
    expect(bad.headers.get("server-timing")).toMatch(/^app;dur=\d+(\.\d+)?$/);
  });
});

describe("posting log lines", () => {
  it("carry the request id of the request that caused them", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    const previous = process.env.LEDGER_LOG;
    process.env.LEDGER_LOG = "on";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await post({
        auth: true,
        key: "k-log",
        headers: { "x-request-id": "req-abc-123" },
        body: { entries: [{ account_id: a.id, amount_minor: 5, currency: "ZAR" }, { account_id: b.id, amount_minor: -5, currency: "ZAR" }] },
      });
      expect(res.status).toBe(201);
      const lines = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
      const posting = lines.filter((l) => l.event === "posting");
      expect(posting).toHaveLength(1);
      expect(lines.every((l) => l.request_id === "req-abc-123")).toBe(true);
      expect(JSON.stringify(lines)).not.toContain(TEST_API_KEY);
    } finally {
      spy.mockRestore();
      process.env.LEDGER_LOG = previous;
    }
  });
});
