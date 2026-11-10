import { describe, expect, it } from "vitest";
import { GET as reset } from "../../src/app/api/cron/reset/route";
import { POST as reverse } from "../../src/app/v1/transactions/[id]/reversals/route";
import { GET as listTransactions } from "../../src/app/v1/transactions/route";
import { GET as integrity } from "../../src/app/v1/integrity/route";
import { call, cleanDatabase } from "../support/harness";
import { openAccount } from "../support/fixtures";

cleanDatabase();

describe("GET /api/cron/reset", () => {
  it("rejects a missing or wrong secret and touches nothing", async () => {
    await openAccount("keep");
    expect((await call(reset, "/api/cron/reset")).status).toBe(401);
    expect((await call(reset, "/api/cron/reset", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await call(integrity, "/v1/integrity")).body.accounts).toBe(1);
  });

  it("empties the ledger and reseeds 50 accounts and 500 transactions with integrity ok", async () => {
    await openAccount("old");
    const res = await call(reset, "/api/cron/reset", { headers: { authorization: "Bearer test-cron-secret" } });
    expect(res.status).toBe(200);
    const check = await call(integrity, "/v1/integrity");
    expect(check.body).toMatchObject({ ok: true, accounts: 50, transactions: 500, entries: 1000 });
  }, 60_000);

  it("is repeatable: a second reset leaves the same ledger", async () => {
    const auth = { headers: { authorization: "Bearer test-cron-secret" } };
    await call(reset, "/api/cron/reset", auth);
    const first = await call(listTransactions, "/v1/transactions", { query: "?limit=1" });
    const res = await call(reset, "/api/cron/reset", auth);
    expect(res.status).toBe(200);
    const check = await call(integrity, "/v1/integrity");
    expect(check.body).toMatchObject({ ok: true, accounts: 50, transactions: 500, entries: 1000 });
    const second = await call(listTransactions, "/v1/transactions", { query: "?limit=1" });
    expect(second.body.data[0].description).toBe(first.body.data[0].description);
    const amounts = (t: { entries: { amount_minor: string }[] }) => t.entries.map((e) => e.amount_minor);
    expect(amounts(second.body.data[0])).toEqual(amounts(first.body.data[0]));
  }, 60_000);

  it("seeds accounts that behave like posted ones: the newest transaction reverses cleanly", async () => {
    await call(reset, "/api/cron/reset", { headers: { authorization: "Bearer test-cron-secret" } });
    const newest = (await call(listTransactions, "/v1/transactions", { query: "?limit=1" })).body.data[0];
    const rev = await call(reverse, "", { method: "POST", auth: true, params: { id: newest.id } });
    expect(rev.status).toBe(201);
    expect((await call(integrity, "/v1/integrity")).body.ok).toBe(true);
  }, 60_000);
});
