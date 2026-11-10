import { systemClock } from "../ledger/clock";
import { createDb, type Db } from "../ledger/db";
import { assertAppRole } from "../ledger/role";
import { LedgerService } from "../ledger/service";
import { log } from "./log";

interface Container {
  db: Db;
  ledger: LedgerService;
  roleChecked: boolean;
}

// Held on globalThis so dev-server module reloads do not leak a pool each time.
const slot = globalThis as typeof globalThis & { __ledger?: Container };

// LEDGER_DATABASE_URL wins: the Neon integration owns DATABASE_URL and points it at the owner role.
export const appDatabaseUrl = (env: NodeJS.ProcessEnv = process.env) => env.LEDGER_DATABASE_URL ?? env.DATABASE_URL;

function build(): Container {
  const url = appDatabaseUrl();
  if (!url) throw new Error("LEDGER_DATABASE_URL (or DATABASE_URL) is not set.");
  const max = process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : undefined;
  const db = createDb(url, { max });
  return { db, ledger: new LedgerService({ db, clock: systemClock, log }), roleChecked: false };
}

export function container(): Container {
  return (slot.__ledger ??= build());
}

export const getLedger = () => container().ledger;
export const getDb = () => container().db;

// Throws a DomainError("unavailable") on a deployed environment connected as the wrong role.
// Success is remembered; a failure is rechecked so fixing the env var recovers without a restart.
export async function ensureAppRole(): Promise<void> {
  const c = container();
  if (c.roleChecked) return;
  await assertAppRole(c.db, { VERCEL_ENV: process.env.VERCEL_ENV });
  c.roleChecked = true;
}
