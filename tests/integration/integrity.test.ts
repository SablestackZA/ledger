import { describe, expect, it } from "vitest";
import { GET as health } from "../../src/app/v1/health/route";
import { GET as integrity } from "../../src/app/v1/integrity/route";
import { call, owner, cleanDatabase } from "../support/harness";
import { openAccount, transfer } from "../support/fixtures";

cleanDatabase();

describe("GET /v1/integrity", () => {
  it("is ok on an empty ledger", async () => {
    const res = await call(integrity, "/v1/integrity");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, unbalanced_transactions: 0, drifted_accounts: 0, entries: 0 });
  });

  it("is ok after postings and counts what it checked", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    await transfer(a.id, b.id, 100, "k1");
    const res = await call(integrity, "/v1/integrity");
    expect(res.body).toMatchObject({ ok: true, accounts: 2, transactions: 1, entries: 2 });
    expect(Date.parse(res.body.checked_at)).not.toBeNaN();
  });

  it("reports ok:false when a cached balance has drifted from its entries", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    await transfer(a.id, b.id, 100, "k1");
    await owner`update accounts set balance_minor = balance_minor + 1 where id = ${a.id}`;
    const res = await call(integrity, "/v1/integrity");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, drifted_accounts: 1, unbalanced_transactions: 0 });
  });

  it("reports ok:false when a transaction does not sum to zero", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    const t = await transfer(a.id, b.id, 100, "k1");
    // The owner switches the backstop off inside one transaction to plant the corruption.
    await owner.begin(async (tx) => {
      await tx`alter table entries disable trigger entries_balanced`;
      await tx`insert into entries (transaction_id, account_id, amount_minor, currency) values (${t.body.id}, ${a.id}, 5, 'ZAR')`;
      await tx`alter table entries enable trigger entries_balanced`;
    });
    const res = await call(integrity, "/v1/integrity");
    expect(res.body.ok).toBe(false);
    expect(res.body.unbalanced_transactions).toBe(1);
  });
});

describe("GET /v1/integrity, transactions without enough entries", () => {
  it("reports ok:false for a transaction row with no entries", async () => {
    // The deferred trigger fires on entry inserts, so a bare transaction row slips past it.
    await owner`insert into transactions (id, idempotency_key, request_hash, posted_at)
      values ('018f0000-0000-7000-8000-0000000000b1', 'bare', ${Buffer.from("x")}, now())`;
    const res = await call(integrity, "/v1/integrity");
    expect(res.body).toMatchObject({ ok: false, transactions_under_two_entries: 1, unbalanced_transactions: 0, drifted_accounts: 0 });
  });
});

describe("GET /v1/health", () => {
  it("returns ok when the database answers", async () => {
    const res = await call(health, "/v1/health");
    expect(res).toMatchObject({ status: 200, body: { ok: true } });
  });
});
