import { v7 as uuidv7 } from "uuid";
import type { Clock } from "./clock";
import type { Db, Tx } from "./db";
import { DomainError, invalidRequest, notFound } from "./errors";
import { hashAccount, preparePosting, type PreparedPosting } from "./posting";
import { demoFixture } from "./seed";
import type {
  Account,
  AccountType,
  Entry,
  Integrity,
  OpenAccountInput,
  Page,
  PostTransactionInput,
  Transaction,
  TransactionEntry,
  TxnStatus,
  Written,
} from "./types";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Keys under this prefix belong to the system (reversals); clients cannot use them.
const SYSTEM_KEY_PREFIX = "sys:";

export type LogFn = (event: string, fields: Record<string, unknown>) => void;

export interface LedgerDeps {
  db: Db;
  clock: Clock;
  log?: LogFn;
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  currency: string;
  balance_minor: bigint;
  version: number;
  created_at: Date;
}

interface TransactionRow {
  id: string;
  description: string | null;
  status: TxnStatus;
  reverses_id: string | null;
  reversed_by: string | null;
  version: number;
  posted_at: Date;
}

interface EntryRow {
  transaction_id: string;
  account_id: string;
  amount_minor: bigint;
  currency: string;
}

const pgCode = (err: unknown): string | undefined =>
  typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined;

export class LedgerService {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly log: LogFn;

  constructor(deps: LedgerDeps) {
    this.db = deps.db;
    this.clock = deps.clock;
    this.log = deps.log ?? (() => {});
  }

  async openAccount(input: OpenAccountInput, idempotencyKey: string): Promise<Written<Account>> {
    assertClientKey(idempotencyKey);
    const now = this.clock.now();
    const hash = hashAccount(input);
    let inserted: AccountRow[] = [];
    let uniqueViolation = false;
    try {
      inserted = await this.db.query<AccountRow[]>`
        insert into accounts (id, code, name, type, currency, idempotency_key, request_hash, created_at)
        values (${uuidv7({ msecs: now.getTime() })}, ${input.code}, ${input.name}, ${input.type}, ${input.currency},
                ${idempotencyKey}, ${hash}, ${now})
        on conflict (idempotency_key) do nothing
        returning id, code, name, type, currency, balance_minor, version, created_at`;
    } catch (err) {
      if (pgCode(err) !== "23505") throw err;
      uniqueViolation = true;
    }
    if (inserted.length === 1) return { value: toAccount(inserted[0]!), replayed: false };

    // Two requests with one key can both pass the arbiter check, and the loser then trips the
    // code index instead. So a 23505 is only a code conflict if the key is not already taken.
    const [existing] = await this.db.query<(AccountRow & { request_hash: Buffer })[]>`
      select id, code, name, type, currency, balance_minor, version, created_at, request_hash
      from accounts where idempotency_key = ${idempotencyKey}`;
    if (!existing) {
      if (uniqueViolation) throw new DomainError("account_code_conflict", `An account with code ${input.code} already exists.`);
      throw idempotencyConflict();
    }
    if (!existing.request_hash.equals(hash)) throw idempotencyConflict();
    return { value: toAccount(existing), replayed: true };
  }

  async postTransaction(input: PostTransactionInput, idempotencyKey: string): Promise<Written<Transaction>> {
    assertClientKey(idempotencyKey);
    const prepared = preparePosting(input);
    const started = performance.now();
    try {
      const out = await retryOnDeadlock(() =>
        this.db.withTransaction((tx) => this.postIn(tx, prepared, idempotencyKey, null)),
      );
      const dbMs = since(started);
      this.log("posting", { outcome: out.replayed ? "replayed" : "posted", duration_ms: dbMs });
      return { ...out, dbMs };
    } catch (err) {
      this.log("posting", { outcome: "failed", code: errorCode(err), duration_ms: since(started) });
      throw err;
    }
  }

  async reverseTransaction(id: string): Promise<Transaction> {
    if (!UUID.test(id)) throw notFound("Transaction", id);
    const started = performance.now();
    try {
      const out = await retryOnDeadlock(() => this.db.withTransaction((tx) => this.reverseIn(tx, id)));
      this.log("posting", { outcome: "reversed", duration_ms: since(started) });
      return out;
    } catch (err) {
      this.log("posting", { outcome: "failed", code: errorCode(err), duration_ms: since(started) });
      throw err;
    }
  }

  async getAccount(id: string): Promise<Account> {
    if (!UUID.test(id)) throw notFound("Account", id);
    const [row] = await this.db.query<AccountRow[]>`
      select id, code, name, type, currency, balance_minor, version, created_at from accounts where id = ${id}`;
    if (!row) throw notFound("Account", id);
    return toAccount(row);
  }

  async listAccounts(opts: { limit?: number; cursor?: string }): Promise<Page<Account>> {
    const limit = clampLimit(opts.limit);
    const after = opts.cursor ? decodeCursor(opts.cursor) : null;
    const rows = await this.db.query<AccountRow[]>`
      select id, code, name, type, currency, balance_minor, version, created_at from accounts
      ${after === null ? this.db.query`` : this.db.query`where code > ${after}`}
      order by code limit ${limit + 1}`;
    return page(rows, limit, toAccount, (r) => r.code);
  }

  async listAccountEntries(accountId: string, opts: { limit?: number; cursor?: string }): Promise<Page<Entry>> {
    await this.getAccount(accountId);
    const limit = clampLimit(opts.limit);
    const after = opts.cursor ? decodeCursor(opts.cursor) : null;
    if (after !== null && !/^\d{1,18}$/.test(after)) throw invalidRequest("Cursor is not valid.");
    const rows = await this.db.query<(EntryRow & { id: bigint; posted_at: Date })[]>`
      select e.id, e.transaction_id, e.account_id, e.amount_minor, e.currency, t.posted_at
      from entries e join transactions t on t.id = e.transaction_id
      where e.account_id = ${accountId} ${after === null ? this.db.query`` : this.db.query`and e.id < ${after}`}
      order by e.id desc limit ${limit + 1}`;
    return page(
      rows,
      limit,
      (r) => ({
        transaction_id: r.transaction_id,
        account_id: r.account_id,
        amount_minor: r.amount_minor.toString(),
        currency: r.currency,
        posted_at: r.posted_at.toISOString(),
      }),
      (r) => r.id.toString(),
    );
  }

  async getTransaction(id: string): Promise<Transaction> {
    if (!UUID.test(id)) throw notFound("Transaction", id);
    const [row] = await this.db.query<TransactionRow[]>`
      select t.id, t.description, t.status, t.reverses_id, r.id as reversed_by, t.version, t.posted_at
      from transactions t left join transactions r on r.reverses_id = t.id
      where t.id = ${id}`;
    if (!row) throw notFound("Transaction", id);
    const entries = await this.db.query<EntryRow[]>`
      select transaction_id, account_id, amount_minor, currency from entries where transaction_id = ${id} order by id`;
    return toTransaction(row, entries);
  }

  async listTransactions(opts: { limit?: number; cursor?: string }): Promise<Page<Transaction>> {
    const limit = clampLimit(opts.limit);
    const after = opts.cursor ? decodeCursor(opts.cursor).split("|") : null;
    if (after && (after.length !== 2 || !isoMillis(after[0]!) || !UUID.test(after[1]!))) {
      throw invalidRequest("Cursor is not valid.");
    }
    // posted_at comes from the app clock at millisecond precision, so the ISO cursor is exact.
    const rows = await this.db.query<TransactionRow[]>`
      select t.id, t.description, t.status, t.reverses_id, r.id as reversed_by, t.version, t.posted_at
      from transactions t left join transactions r on r.reverses_id = t.id
      ${after === null ? this.db.query`` : this.db.query`where (t.posted_at, t.id) < (${after[0]!}::timestamptz, ${after[1]!}::uuid)`}
      order by t.posted_at desc, t.id desc limit ${limit + 1}`;
    const shown = rows.slice(0, limit);
    const entries = shown.length
      ? await this.db.query<EntryRow[]>`
          select transaction_id, account_id, amount_minor, currency from entries
          where transaction_id in ${this.db.query(shown.map((r) => r.id))} order by id`
      : [];
    const grouped = new Map<string, EntryRow[]>();
    for (const e of entries) grouped.set(e.transaction_id, [...(grouped.get(e.transaction_id) ?? []), e]);
    const last = shown[shown.length - 1];
    return {
      data: shown.map((r) => toTransaction(r, grouped.get(r.id) ?? [])),
      next_cursor: rows.length > limit && last ? encodeCursor(`${last.posted_at.toISOString()}|${last.id}`) : null,
    };
  }

  async checkIntegrity(): Promise<Integrity> {
    const [row] = await this.db.withTransaction(async (tx) => {
      // O(entries); a longer budget than the 5s posting guard, scoped to this transaction.
      await tx`set local statement_timeout = '30s'`;
      return tx<{ unbalanced: bigint; drifted: bigint; thin: bigint; accounts: bigint; transactions: bigint; entries: bigint }[]>`
        select
          (select count(*) from (
             select transaction_id, currency from entries group by 1, 2 having sum(amount_minor) <> 0
           ) u) as unbalanced,
          (select count(*) from accounts a
             where balance_minor <> coalesce((select sum(amount_minor) from entries e where e.account_id = a.id), 0)) as drifted,
          (select count(*) from transactions t
             where (select count(*) from entries e where e.transaction_id = t.id) < 2) as thin,
          (select count(*) from accounts) as accounts,
          (select count(*) from transactions) as transactions,
          (select count(*) from entries) as entries`;
    });
    const unbalanced = Number(row!.unbalanced);
    const drifted = Number(row!.drifted);
    const thin = Number(row!.thin);
    return {
      ok: unbalanced === 0 && drifted === 0 && thin === 0,
      unbalanced_transactions: unbalanced,
      transactions_under_two_entries: thin,
      drifted_accounts: drifted,
      accounts: Number(row!.accounts),
      transactions: Number(row!.transactions),
      entries: Number(row!.entries),
      checked_at: this.clock.now().toISOString(),
    };
  }

  // Truncate and reload in one transaction: readers see the old ledger or the new one,
  // and one multi-row insert per table keeps it fast on a round-trip-bound database.
  async resetDemo(accounts = 50, transactions = 500): Promise<void> {
    const fixture = demoFixture(this.clock.now(), accounts, transactions);
    await this.db.withTransaction(async (tx) => {
      await tx`select ledger_reset()`;
      await tx`insert into accounts ${tx(fixture.accounts)}`;
      await tx`insert into transactions ${tx(fixture.transactions)}`;
      await tx`insert into entries ${tx(fixture.entries)}`;
    });
  }

  private async postIn(
    tx: Tx,
    p: PreparedPosting,
    key: string,
    reversesId: string | null,
  ): Promise<Written<Transaction>> {
    const now = this.clock.now();
    const id = uuidv7({ msecs: now.getTime() });

    const inserted = await tx`
      insert into transactions (id, idempotency_key, request_hash, description, reverses_id, posted_at)
      values (${id}, ${key}, ${p.requestHash}, ${p.description}, ${reversesId}, ${now})
      on conflict (idempotency_key) do nothing returning id`;
    if (inserted.length === 0) {
      const [existing] = await tx<{ id: string; request_hash: Buffer }[]>`
        select id, request_hash from transactions where idempotency_key = ${key}`;
      if (!existing || !existing.request_hash.equals(p.requestHash)) throw idempotencyConflict();
      const [row] = await tx<TransactionRow[]>`
        select t.id, t.description, t.status, t.reverses_id, r.id as reversed_by, t.version, t.posted_at
        from transactions t left join transactions r on r.reverses_id = t.id where t.id = ${existing.id}`;
      const entries = await tx<EntryRow[]>`
        select transaction_id, account_id, amount_minor, currency from entries where transaction_id = ${existing.id} order by id`;
      return { value: toTransaction(row!, entries), replayed: true };
    }

    // Ordered locks: concurrent postings that share accounts queue instead of deadlocking.
    const locked = await tx<{ id: string; currency: string }[]>`
      select id, currency from accounts where id in ${tx(p.accountIds)} order by id for update`;
    const currencies = new Map(locked.map((a) => [a.id, a.currency]));
    const missing = p.accountIds.filter((a) => !currencies.has(a));
    if (missing.length > 0) {
      throw new DomainError("unknown_account", `Unknown account: ${missing.join(", ")}.`, { account_ids: missing });
    }
    const mismatched = p.entries.filter((e) => currencies.get(e.account_id) !== e.currency);
    if (mismatched.length > 0) {
      throw new DomainError("currency_mismatch", "An entry currency differs from its account currency.", {
        entries: mismatched.map((e) => ({
          account_id: e.account_id,
          entry_currency: e.currency,
          account_currency: currencies.get(e.account_id),
        })),
      });
    }

    await tx`insert into entries ${tx(
      p.entries.map((e) => ({ transaction_id: id, account_id: e.account_id, amount_minor: e.amount_minor, currency: e.currency })),
      "transaction_id",
      "account_id",
      "amount_minor",
      "currency",
    )}`;
    await tx`
      update accounts a set balance_minor = a.balance_minor + d.delta, version = a.version + 1
      from (select * from unnest(${p.accountIds}::uuid[], ${p.deltas}::bigint[]) as u(id, delta)) d
      where a.id = d.id`;

    return {
      replayed: false,
      value: {
        id,
        description: p.description,
        status: "posted",
        reverses_id: reversesId,
        reversed_by: null,
        version: 0,
        posted_at: now.toISOString(),
        entries: p.entries.map(toEntryDto),
      },
    };
  }

  private async reverseIn(tx: Tx, id: string): Promise<Transaction> {
    const [original] = await tx<{ status: TxnStatus; version: number; reverses_id: string | null }[]>`
      select status, version, reverses_id from transactions where id = ${id}`;
    if (!original) throw notFound("Transaction", id);
    if (original.reverses_id) {
      throw new DomainError("not_reversible", "A reversal cannot itself be reversed.", {
        transaction_id: id,
        status: original.status,
        reverses_id: original.reverses_id,
      });
    }
    if (original.status === "reversed") throw await alreadyReversed(tx, id);

    // Of two concurrent reversals, the second blocks on this row and then matches nothing.
    const flipped = await tx`
      update transactions set status = 'reversed', version = version + 1
      where id = ${id} and status = 'posted' and version = ${original.version} returning id`;
    if (flipped.length === 0) throw await alreadyReversed(tx, id);

    const entries = await tx<EntryRow[]>`
      select transaction_id, account_id, amount_minor, currency from entries where transaction_id = ${id} order by id`;
    const prepared = preparePosting({
      description: `Reversal of ${id}`,
      entries: entries.map((e) => ({ account_id: e.account_id, amount_minor: -e.amount_minor, currency: e.currency })),
    });
    const out = await this.postIn(tx, prepared, `${SYSTEM_KEY_PREFIX}reversal:${id}`, id);
    if (out.replayed) throw new Error(`reversal key for ${id} already used by a different transaction`);
    return out.value;
  }
}

async function alreadyReversed(tx: Tx, id: string): Promise<DomainError> {
  const [r] = await tx<{ status: TxnStatus; reversed_by: string | null }[]>`
    select t.status, (select x.id from transactions x where x.reverses_id = t.id) as reversed_by
    from transactions t where t.id = ${id}`;
  return new DomainError("already_reversed", "This transaction has already been reversed.", {
    transaction_id: id,
    status: r?.status ?? "reversed",
    reversed_by: r?.reversed_by ?? null,
  });
}

const idempotencyConflict = () =>
  new DomainError("idempotency_conflict", "This Idempotency-Key was already used with a different request body.");

function assertClientKey(key: string): void {
  if (key.length < 1 || key.length > 128) throw invalidRequest("Idempotency-Key must be 1 to 128 characters.");
  if (key.startsWith(SYSTEM_KEY_PREFIX)) throw invalidRequest(`Idempotency-Key cannot start with "${SYSTEM_KEY_PREFIX}".`);
}

// Ordered locking should prevent deadlocks; 40P01 is mapped if one is seen anyway (§8).
async function retryOnDeadlock<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (first) {
    if (pgCode(first) !== "40P01") throw first;
    try {
      return await fn();
    } catch (second) {
      if (pgCode(second) === "40P01") throw new DomainError("retry", "The ledger is busy. Retry the request.");
      throw second;
    }
  }
}

const since = (t0: number) => Math.round((performance.now() - t0) * 100) / 100;
const errorCode = (err: unknown) => (err instanceof DomainError ? err.code : (pgCode(err) ?? "internal"));

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalidRequest(`limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }
  return limit;
}

// Strict: a looser cursor timestamp would reach the ::timestamptz cast and surface as a 500, not a 422.
const ISO_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isoMillis = (v: string) => {
  if (!ISO_MILLIS.test(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.toISOString() === v;
};

const encodeCursor = (raw: string) => Buffer.from(raw, "utf8").toString("base64url");
function decodeCursor(cursor: string): string {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  if (raw === "" || encodeCursor(raw) !== cursor) throw invalidRequest("Cursor is not valid.");
  return raw;
}

function page<R, T>(rows: R[], limit: number, map: (r: R) => T, cursorOf: (r: R) => string): Page<T> {
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return {
    data: shown.map(map),
    next_cursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null,
  };
}

const toEntryDto = (e: { account_id: string; amount_minor: bigint; currency: string }): TransactionEntry => ({
  account_id: e.account_id,
  amount_minor: e.amount_minor.toString(),
  currency: e.currency,
});

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  code: r.code,
  name: r.name,
  type: r.type,
  currency: r.currency,
  balance_minor: r.balance_minor.toString(),
  version: r.version,
  created_at: r.created_at.toISOString(),
});

const toTransaction = (r: TransactionRow, entries: EntryRow[]): Transaction => ({
  id: r.id,
  description: r.description,
  status: r.status,
  reverses_id: r.reverses_id,
  reversed_by: r.reversed_by,
  version: r.version,
  posted_at: r.posted_at.toISOString(),
  entries: entries.map(toEntryDto),
});
