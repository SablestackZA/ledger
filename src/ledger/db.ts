import postgres from "postgres";

export type Sql = postgres.Sql<{ bigint: bigint }>;
export type Tx = postgres.TransactionSql<{ bigint: bigint }>;

// Port over Postgres. There is deliberately no fake: the invariants live partly in
// SQL triggers and row locks, so tests run against a real database.
export interface Db {
  query: Sql;
  withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DbOptions {
  max?: number;
}

// Neon pooled hosts contain "-pooler" and sit behind PgBouncer in transaction mode, where
// server-side prepared statements are not safe to assume. Everything else keeps them.
export const isPooledHost = (url: string): boolean => {
  try {
    return new URL(url).hostname.includes("-pooler");
  } catch {
    return false;
  }
};

export function createDb(url: string, options: DbOptions = {}): Db {
  const sql: Sql = postgres(url, {
    max: options.max ?? 20,
    connect_timeout: 3,
    idle_timeout: 30,
    prepare: !isPooledHost(url),
    types: { bigint: postgres.BigInt },
    onnotice: () => {},
    // Timeouts live on the ledger_app role (migration 0002): startup parameters fail behind a pooler.
  });
  return {
    query: sql,
    // READ COMMITTED, the Postgres default; concurrency control is the ordered row lock.
    withTransaction: <T>(fn: (tx: Tx) => Promise<T>) => sql.begin(fn) as Promise<T>,
    close: () => sql.end({ timeout: 5 }),
  };
}
