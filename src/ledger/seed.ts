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

const DEMO_NAMES: Record<AccountType, string> = {
  asset: "Bank account",
  liability: "Loan",
  equity: "Capital",
  income: "Sales",
  expense: "Operating costs",
};

const demoAccountInput = (i: number): OpenAccountInput => {
  const type = TYPES[i % TYPES.length]!;
  const n = String(i + 1).padStart(4, "0");
  return { code: `demo-${n}`, name: `${DEMO_NAMES[type]} ${Math.floor(i / TYPES.length) + 1}`, type, currency: "ZAR" };
};

interface Movement {
  debit: number;
  credit: number;
  amount: bigint;
  description: string;
}

// Keeps every account on its normal side (assets and expenses >= 0, the rest <= 0): money enters
// through receipts, capital and loans, and leaves through payments sized to the balance.
function nextMovement(rand: () => number, byType: Record<AccountType, number[]>, balance: (i: number) => bigint): Movement {
  const pick = (xs: number[]) => xs[Math.floor(rand() * xs.length)]!;
  const amount = () => BigInt(100 + Math.floor(rand() * 500_000));
  const fundedAsset = () => {
    const best = byType.asset.reduce((a, b) => (balance(b) > balance(a) ? b : a));
    const chosen = pick(byType.asset);
    return balance(chosen) >= 200n ? chosen : best;
  };
  // Half of the chosen balance at most, so an account never drains to zero.
  const spendable = (i: number, want: bigint) => {
    const cap = balance(i) / 2n;
    return want < cap ? want : cap;
  };

  const roll = rand() * 100;
  const receipt = (): Movement => {
    if (rand() < 0.85) return { debit: pick(byType.asset), credit: pick(byType.income), amount: amount(), description: "Customer receipt" };
    return { debit: pick(byType.asset), credit: pick(byType.equity), amount: amount(), description: "Capital contribution" };
  };

  if (roll < 35) return receipt();
  if (roll < 40) return { debit: pick(byType.asset), credit: pick(byType.liability), amount: amount(), description: "Loan drawdown" };

  const source = fundedAsset();
  if (balance(source) < 200n) return receipt();

  if (roll < 75) {
    return { debit: pick(byType.expense), credit: source, amount: spendable(source, amount()), description: "Supplier payment" };
  }
  if (roll < 88) {
    const owing = byType.liability.reduce((a, b) => (balance(b) < balance(a) ? b : a));
    const outstanding = -balance(owing);
    if (outstanding >= 100n) {
      const want = amount();
      const pay = spendable(source, outstanding < want ? outstanding : want);
      if (pay >= 1n) return { debit: owing, credit: source, amount: pay, description: "Loan repayment" };
    }
    return receipt();
  }
  const others = byType.asset.filter((i) => i !== source);
  return { debit: pick(others), credit: source, amount: spendable(source, amount()), description: "Transfer between accounts" };
}

// Pure row fixture for the nightly reset: balances, versions and hashes match what posting and replay produce.
// Transactions are one second apart, ending at `now`, so ids and posted_at agree in order.
export function demoFixture(now: Date, accountCount: number, transactionCount: number) {
  if (accountCount < TYPES.length * 2) throw new Error(`The demo needs at least ${TYPES.length * 2} accounts.`);
  const rand = lcg(2026);
  const created = new Date(now.getTime() - (transactionCount + 1) * 1000);
  const balances = new Map<number, { balance: bigint; version: number }>();
  const balance = (i: number) => balances.get(i)?.balance ?? 0n;
  const accounts = Array.from({ length: accountCount }, (_, i) => ({
    index: i,
    id: uuidv7({ msecs: created.getTime() }),
    input: demoAccountInput(i),
  }));
  const byType = Object.fromEntries(TYPES.map((t) => [t, accounts.filter((a) => a.input.type === t).map((a) => a.index)])) as Record<
    AccountType,
    number[]
  >;

  const transactions: Record<string, unknown>[] = [];
  const entries: Record<string, unknown>[] = [];
  for (let i = 0; i < transactionCount; i++) {
    const m = nextMovement(rand, byType, balance);
    const postedAt = new Date(now.getTime() - (transactionCount - 1 - i) * 1000);
    const id = uuidv7({ msecs: postedAt.getTime() });
    const prepared = preparePosting({
      description: m.description,
      entries: [
        { account_id: accounts[m.debit]!.id, amount_minor: m.amount, currency: "ZAR" },
        { account_id: accounts[m.credit]!.id, amount_minor: -m.amount, currency: "ZAR" },
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
    for (const [idx, delta] of [[m.debit, m.amount], [m.credit, -m.amount]] as const) {
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
      balance_minor: balance(a.index),
      version: balances.get(a.index)?.version ?? 0,
      idempotency_key: accountKey("demo", a.index),
      request_hash: hashAccount(a.input),
      created_at: created,
    })),
    transactions,
    entries,
  };
}
