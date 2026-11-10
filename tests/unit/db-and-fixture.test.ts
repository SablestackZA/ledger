import { describe, expect, it } from "vitest";
import { isPooledHost } from "../../src/ledger/db";
import { demoFixture } from "../../src/ledger/seed";

describe("isPooledHost", () => {
  it("recognises a Neon pooled host and nothing else", () => {
    expect(isPooledHost("postgres://u@ep-jolly-lake-abc123-pooler.c-15.us-east-1.aws.neon.tech/db")).toBe(true);
    expect(isPooledHost("postgres://u@ep-jolly-lake-abc123.c-15.us-east-1.aws.neon.tech/db")).toBe(false);
    expect(isPooledHost("postgres://u@127.0.0.1:54329/ledger")).toBe(false);
    expect(isPooledHost("not a url")).toBe(false);
  });
});

describe("demoFixture", () => {
  const now = new Date("2026-11-10T01:00:00.000Z");
  const f = demoFixture(now, 50, 500);

  it("builds 50 accounts, 500 transactions and 1000 entries", () => {
    expect([f.accounts.length, f.transactions.length, f.entries.length]).toEqual([50, 500, 1000]);
  });

  it("balances to zero overall and per transaction, with versions equal to postings touched", () => {
    const total = f.accounts.reduce((s, a) => s + a.balance_minor, 0n);
    expect(total).toBe(0n);
    expect(f.accounts.reduce((s, a) => s + a.version, 0)).toBe(1000);
    const perTxn = new Map<unknown, bigint>();
    for (const e of f.entries) perTxn.set(e.transaction_id, (perTxn.get(e.transaction_id) ?? 0n) + (e.amount_minor as bigint));
    expect([...perTxn.values()].every((v) => v === 0n)).toBe(true);
  });

  it("is deterministic and ends at the given instant", () => {
    const again = demoFixture(now, 50, 500);
    expect(again.accounts.map((a) => a.balance_minor)).toEqual(f.accounts.map((a) => a.balance_minor));
    expect((f.transactions.at(-1)!.posted_at as Date).toISOString()).toBe(now.toISOString());
  });
});
