import { describe, expect, it } from "vitest";
import { GET as getAccount } from "../../src/app/v1/accounts/[id]/route";
import { POST as reverse } from "../../src/app/v1/transactions/[id]/reversals/route";
import { GET as getTransaction } from "../../src/app/v1/transactions/[id]/route";
import { call, cleanDatabase } from "../support/harness";
import { openAccount, transfer } from "../support/fixtures";

cleanDatabase();

const rev = (id: string, auth: boolean = true) => call(reverse, "", { method: "POST", auth, params: { id } });
const balance = async (id: string) => (await call(getAccount, "", { params: { id } })).body.balance_minor;

async function posted() {
  const a = await openAccount("a");
  const b = await openAccount("b");
  const t = await transfer(a.id, b.id, 900, "k1");
  return { a, b, t: t.body };
}

describe("POST /v1/transactions/{id}/reversals", () => {
  it("posts the negated entries, marks the original reversed and restores balances", async () => {
    const { a, b, t } = await posted();
    const res = await rev(t.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "posted", reverses_id: t.id });
    expect(res.body.entries).toEqual([
      { account_id: b.id, amount_minor: "-900", currency: "ZAR" },
      { account_id: a.id, amount_minor: "900", currency: "ZAR" },
    ]);
    expect(await balance(a.id)).toBe("0");
    expect(await balance(b.id)).toBe("0");
    const original = await call(getTransaction, "", { params: { id: t.id } });
    expect(original.body).toMatchObject({ status: "reversed", reversed_by: res.body.id, version: 1 });
  });

  it("returns 409 with the current state when reversed twice", async () => {
    const { t } = await posted();
    const first = await rev(t.id);
    const second = await rev(t.id);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: "already_reversed",
      details: { transaction_id: t.id, status: "reversed", reversed_by: first.body.id },
    });
  });

  it("lets exactly one of many simultaneous reversals through", async () => {
    const { a, b, t } = await posted();
    const results = await Promise.all(Array.from({ length: 10 }, () => rev(t.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await balance(a.id)).toBe("0");
    expect(await balance(b.id)).toBe("0");
  });

  it("refuses to reverse a reversal", async () => {
    const { t } = await posted();
    const first = await rev(t.id);
    const res = await rev(first.body.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_reversible");
  });

  it("returns 404 for an unknown transaction and 401 without the key", async () => {
    expect((await rev("018f0000-0000-7000-8000-0000000000ff")).status).toBe(404);
    const { t } = await posted();
    expect((await rev(t.id, false)).status).toBe(401);
  });
});
