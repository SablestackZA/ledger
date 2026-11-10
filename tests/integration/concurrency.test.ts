import { describe, expect, it } from "vitest";
import { GET as getAccount } from "../../src/app/v1/accounts/[id]/route";
import { GET as integrity } from "../../src/app/v1/integrity/route";
import { call, cleanDatabase } from "../support/harness";
import { openAccount, transfer } from "../support/fixtures";

cleanDatabase();

describe("concurrent postings", () => {
  it("200 parallel transfers between 3 accounts leave integrity ok and balances at the expected sums", async () => {
    const accounts = [await openAccount("x"), await openAccount("y"), await openAccount("z")];
    const expected = new Map(accounts.map((a) => [a.id, 0n]));

    // Both directions across every pair, so ordered locking meets real contention.
    const jobs = Array.from({ length: 200 }, (_, i) => {
      const fromIdx = i % 3;
      const from = accounts[fromIdx]!;
      const to = accounts[(fromIdx + 1 + (Math.floor(i / 3) % 2)) % 3]!;
      const amount = BigInt(1 + ((i * 37) % 997));
      expected.set(from.id, expected.get(from.id)! - amount);
      expected.set(to.id, expected.get(to.id)! + amount);
      return transfer(from.id, to.id, amount.toString(), `c${i}`);
    });
    const results = await Promise.all(jobs);

    expect(results.map((r) => r.status)).toEqual(Array(200).fill(201));
    for (const a of accounts) {
      const res = await call(getAccount, "", { params: { id: a.id } });
      expect(res.body.balance_minor).toBe(expected.get(a.id)!.toString());
    }
    const check = await call(integrity, "/v1/integrity");
    expect(check.body).toMatchObject({ ok: true, transactions: 200, entries: 400, unbalanced_transactions: 0, drifted_accounts: 0 });
    expect([...expected.values()].reduce((s, v) => s + v, 0n)).toBe(0n);
  });
});
