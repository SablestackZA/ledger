import { describe, expect, it } from "vitest";
import type { Clock } from "../../src/ledger/clock";
import type { Db } from "../../src/ledger/db";
import { hashAccount } from "../../src/ledger/posting";
import { LedgerService } from "../../src/ledger/service";

// The race is a microsecond window inside Postgres. Script the two statements openAccount issues:
// the insert fails with 23505 (code index tripped first), then the key lookup answers.
const input = { code: "1000", name: "Cash", type: "asset" as const, currency: "ZAR" };
const clock: Clock = { now: () => new Date("2026-11-10T09:00:00.000Z") };
const row = (hash: Buffer) => ({
  id: "018f0000-0000-7000-8000-0000000000a1", ...input, balance_minor: 0n, version: 0, created_at: clock.now(), request_hash: hash,
});

function serviceWith(lookup: unknown[]) {
  const calls: (() => unknown)[] = [
    () => Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" })),
    () => Promise.resolve(lookup),
  ];
  const db = { query: () => calls.shift()!(), withTransaction: async () => { throw new Error("unused"); }, close: async () => {} } as unknown as Db;
  return new LedgerService({ db, clock });
}

describe("openAccount when the insert trips the code index", () => {
  it("replays when the key already holds an identical request", async () => {
    const out = await serviceWith([row(hashAccount(input))]).openAccount(input, "k1");
    expect(out.replayed).toBe(true);
    expect(out.value.code).toBe("1000");
  });

  it("answers idempotency_conflict when the key holds a different request", async () => {
    await expect(serviceWith([row(hashAccount({ ...input, name: "Other" }))]).openAccount(input, "k1")).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
  });

  it("answers account_code_conflict only when the key is not taken", async () => {
    await expect(serviceWith([]).openAccount(input, "k1")).rejects.toMatchObject({ code: "account_code_conflict" });
  });
});
