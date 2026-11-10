import { v7 as uuidv7 } from "uuid";
import { hashAccount, preparePosting } from "./posting";
import type { LedgerService } from "./service";
import type { AccountType, OpenAccountInput } from "./types";

const TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];

const accountInput = (prefix: string, i: number): OpenAccountInput => {
  const n = String(i + 1).padStart(4, "0");
  return { code: `${prefix}-${n}`, name: `Account ${n}`, type: TYPES[i % TYPES.length]!, currency: "ZAR" };
};
const accountKey = (prefix: string, i: number) => `${prefix}-account-${String(i + 1).padStart(4, "0")}`;

export async function seedAccounts(ledger: LedgerService, count: number, prefix = "seed"): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const { value } = await ledger.openAccount(accountInput(prefix, i), accountKey(prefix, i));
    ids.push(value.id);
  }
  return ids;
}

// Deterministic, so every reset yields the same ledger.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

// Pure row fixture for the nightly reset: balances, versions and hashes match what posting and replay produce.
// Transactions are one second apart, ending at `now`, so ids and posted_at agree in order.
export function demoFixture(now: Date, accountCount: number, transactionCount: number) {
  const rand = lcg(2026);
  const created = new Date(now.getTime() - (transactionCount + 1) * 1000);
  const balances = new Map<number, { balance: bigint; version: number }>();
  const accounts = Array.from({ length: accountCount }, (_, i) => {
    const input = accountInput("demo", i);
    return { index: i, id: uuidv7({ msecs: created.getTime() }), input };
  });

  const transactions: Record<string, unknown>[] = [];
  const entries: Record<string, unknown>[] = [];
  for (let i = 0; i < transactionCount; i++) {
    const from = Math.floor(rand() * accountCount);
    let to = Math.floor(rand() * accountCount);
    if (to === from) to = (to + 1) % accountCount;
    const amount = BigInt(100 + Math.floor(rand() * 500_000));
    const postedAt = new Date(now.getTime() - (transactionCount - 1 - i) * 1000);
    const id = uuidv7({ msecs: postedAt.getTime() });
    const prepared = preparePosting({
      description: `Transfer ${i + 1}`,
      entries: [
        { account_id: accounts[to]!.id, amount_minor: amount, currency: "ZAR" },
        { account_id: accounts[from]!.id, amount_minor: -amount, currency: "ZAR" },
      ],
    });
    transactions.push({
      id,
      idempotency_key: `demo-txn-${String(i + 1).padStart(4, "0")}`,
      request_hash: prepared.requestHash,
      description: prepared.description,
      status: "posted",
      reverses_id: null,
      version: 0,
      posted_at: postedAt,
    });
    for (const e of prepared.entries) {
      entries.push({ transaction_id: id, account_id: e.account_id, amount_minor: e.amount_minor, currency: e.currency });
    }
    for (const [idx, delta] of [[to, amount], [from, -amount]] as const) {
      const b = balances.get(idx) ?? { balance: 0n, version: 0 };
      balances.set(idx, { balance: b.balance + delta, version: b.version + 1 });
    }
  }

  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      code: a.input.code,
      name: a.input.name,
      type: a.input.type,
      currency: a.input.currency,
      balance_minor: balances.get(a.index)?.balance ?? 0n,
      version: balances.get(a.index)?.version ?? 0,
      idempotency_key: accountKey("demo", a.index),
      request_hash: hashAccount(a.input),
      created_at: created,
    })),
    transactions,
    entries,
  };
}
