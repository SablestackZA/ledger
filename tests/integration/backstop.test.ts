import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { app, owner, cleanDatabase } from "../support/harness";
import { openAccount } from "../support/fixtures";

cleanDatabase();

const TXN = "018f0000-0000-7000-8000-0000000000a1";
type Tx = postgres.TransactionSql;
const insertTxn = (tx: Tx) =>
  tx`insert into transactions (id, idempotency_key, request_hash, posted_at) values (${TXN}, 'raw', ${Buffer.from("x")}, now())`;
const entriesCount = async () => (await owner<{ n: string }[]>`select count(*) as n from entries`)[0]!.n;

describe("database backstops (raw SQL as the app role, bypassing the service)", () => {
  it("fails at commit when an inserted set of entries does not sum to zero", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    await expect(
      app.begin(async (tx) => {
        await insertTxn(tx);
        await tx`insert into entries (transaction_id, account_id, amount_minor, currency) values (${TXN}, ${a.id}, 100, 'ZAR')`;
        await tx`insert into entries (transaction_id, account_id, amount_minor, currency) values (${TXN}, ${b.id}, -90, 'ZAR')`;
      }),
    ).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("does not sum to zero") });
    expect(await entriesCount()).toBe("0");
  });

  it("fails at commit when a transaction has a single entry", async () => {
    const a = await openAccount("a");
    await expect(
      app.begin(async (tx) => {
        await insertTxn(tx);
        await tx`insert into entries (transaction_id, account_id, amount_minor, currency) values (${TXN}, ${a.id}, 100, 'ZAR')`;
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("accepts a balanced set at commit", async () => {
    const a = await openAccount("a");
    const b = await openAccount("b");
    await app.begin(async (tx) => {
      await insertTxn(tx);
      await tx`insert into entries (transaction_id, account_id, amount_minor, currency) values (${TXN}, ${a.id}, 100, 'ZAR'), (${TXN}, ${b.id}, -100, 'ZAR')`;
    });
    expect(await entriesCount()).toBe("2");
  });

  it("rejects an entry whose currency differs from its account", async () => {
    const a = await openAccount("a", "ZAR");
    const b = await openAccount("b", "ZAR");
    await expect(
      app.begin(async (tx) => {
        await insertTxn(tx);
        await tx`insert into entries (transaction_id, account_id, amount_minor, currency) values (${TXN}, ${a.id}, 100, 'USD'), (${TXN}, ${b.id}, -100, 'USD')`;
      }),
    ).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("does not match account") });
  });

  it("rejects a zero-amount entry", async () => {
    const a = await openAccount("a");
    await expect(
      app.begin(async (tx) => {
        await insertTxn(tx);
        await tx`insert into entries (transaction_id, account_id, amount_minor, currency) values (${TXN}, ${a.id}, 0, 'ZAR')`;
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("app role privileges", () => {
  it("cannot UPDATE or DELETE entries, truncate them, or run DDL", async () => {
    await expect(app`update entries set amount_minor = 1`).rejects.toMatchObject({ code: "42501" });
    await expect(app`delete from entries`).rejects.toMatchObject({ code: "42501" });
    await expect(app`truncate entries`).rejects.toMatchObject({ code: "42501" });
    await expect(app`create table sneaky (x int)`).rejects.toMatchObject({ code: "42501" });
  });
});
