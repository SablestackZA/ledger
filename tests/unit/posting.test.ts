import { describe, expect, it } from "vitest";
import { DomainError } from "../../src/ledger/errors";
import { hashAccount, preparePosting } from "../../src/ledger/posting";
import { LedgerService } from "../../src/ledger/service";
import type { Db } from "../../src/ledger/db";
import type { Clock } from "../../src/ledger/clock";

const A = "018f0000-0000-7000-8000-00000000000a";
const B = "018f0000-0000-7000-8000-00000000000b";
const C = "018f0000-0000-7000-8000-00000000000c";

const entry = (account_id: string, amount: bigint, currency = "ZAR") => ({ account_id, amount_minor: amount, currency });

function reject(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    return err as DomainError;
  }
  throw new Error("expected a DomainError");
}

describe("preparePosting", () => {
  it("accepts a balanced two-entry transfer and nets deltas per account in lock order", () => {
    const p = preparePosting({ entries: [entry(B, 500n), entry(A, -500n)] });
    expect(p.accountIds).toEqual([A, B]);
    expect(p.deltas).toEqual([-500n, 500n]);
  });

  it("nets repeated accounts into one delta", () => {
    const p = preparePosting({ entries: [entry(A, -300n), entry(B, 100n), entry(B, 100n), entry(C, 100n)] });
    expect(p.accountIds).toEqual([A, B, C]);
    expect(p.deltas).toEqual([-300n, 200n, 100n]);
  });

  it("rejects fewer than 2 entries", () => {
    expect(reject(() => preparePosting({ entries: [entry(A, 0n)] })).code).toBe("invalid_request");
  });

  it("rejects more than 50 entries", () => {
    const entries = Array.from({ length: 51 }, (_, i) => entry(i % 2 ? A : B, i % 2 ? 1n : -1n));
    expect(reject(() => preparePosting({ entries })).code).toBe("invalid_request");
  });

  it("rejects a zero amount", () => {
    expect(reject(() => preparePosting({ entries: [entry(A, 0n), entry(B, 0n)] })).code).toBe("invalid_request");
  });

  it("rejects a malformed currency", () => {
    const err = reject(() => preparePosting({ entries: [entry(A, 5n, "zar"), entry(B, -5n, "zar")] }));
    expect(err.code).toBe("invalid_request");
  });

  it("rejects an unbalanced set and reports the sum per currency", () => {
    const err = reject(() => preparePosting({ entries: [entry(A, 100n), entry(B, -90n)] }));
    expect(err.code).toBe("unbalanced");
    expect(err.details).toEqual({ sums: { ZAR: "10" } });
  });

  it("requires each currency to balance on its own", () => {
    const err = reject(() =>
      preparePosting({ entries: [entry(A, 100n, "ZAR"), entry(B, -100n, "USD")] }),
    );
    expect(err.code).toBe("unbalanced");
    expect(err.details).toEqual({ sums: { ZAR: "100", USD: "-100" } });
  });

  it("accepts a balanced multi-currency set", () => {
    const p = preparePosting({
      entries: [entry(A, 100n, "ZAR"), entry(B, -100n, "ZAR"), entry(A, 7n, "USD"), entry(B, -7n, "USD")],
    });
    expect(p.deltas).toEqual([107n, -107n]);
  });

  it("hashes equal requests equally and different requests differently", () => {
    const base = preparePosting({ description: "x", entries: [entry(A, 5n), entry(B, -5n)] });
    expect(base.requestHash.equals(preparePosting({ description: "x", entries: [entry(A, 5n), entry(B, -5n)] }).requestHash)).toBe(true);
    expect(base.requestHash.equals(preparePosting({ description: "y", entries: [entry(A, 5n), entry(B, -5n)] }).requestHash)).toBe(false);
    expect(base.requestHash.equals(preparePosting({ description: "x", entries: [entry(A, 6n), entry(B, -6n)] }).requestHash)).toBe(false);
  });

  it("hashes accounts by every field", () => {
    const a = { code: "1", name: "n", type: "asset" as const, currency: "ZAR" };
    expect(hashAccount(a).equals(hashAccount({ ...a }))).toBe(true);
    expect(hashAccount(a).equals(hashAccount({ ...a, currency: "USD" }))).toBe(false);
  });
});

// A Db that fails the test if touched: validation must reject before any write.
const untouchable: Db = {
  query: new Proxy({}, { get: () => { throw new Error("db touched"); } }) as never,
  withTransaction: async () => { throw new Error("db touched"); },
  close: async () => {},
};
const fixedClock: Clock = { now: () => new Date("2026-11-10T09:00:00.000Z") };

describe("LedgerService validation, before any I/O", () => {
  const service = new LedgerService({ db: untouchable, clock: fixedClock });

  it("rejects an unbalanced posting without touching the database", async () => {
    await expect(
      service.postTransaction({ entries: [entry(A, 100n), entry(B, -1n)] }, "k1"),
    ).rejects.toMatchObject({ code: "unbalanced" });
  });

  it("rejects a client idempotency key in the system namespace", async () => {
    await expect(
      service.postTransaction({ entries: [entry(A, 100n), entry(B, -100n)] }, "sys:reversal:x"),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects an idempotency key over 128 characters", async () => {
    await expect(
      service.postTransaction({ entries: [entry(A, 100n), entry(B, -100n)] }, "k".repeat(129)),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("treats a malformed id as not found", async () => {
    await expect(service.getTransaction("nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(service.getAccount("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});
