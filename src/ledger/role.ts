import { DomainError } from "./errors";
import type { Db } from "./db";

export const APP_ROLE = "ledger_app";

// On Vercel the app must connect as ledger_app: the Neon integration's DATABASE_URL is the owner,
// so a missing LEDGER_DATABASE_URL would run with DDL and DELETE rights. Local dev and tests are exempt.
export async function assertAppRole(db: Db, env: { VERCEL_ENV?: string }): Promise<void> {
  if (!env.VERCEL_ENV) return;
  const [row] = await db.query<{ role: string }[]>`select current_user as role`;
  if (row?.role !== APP_ROLE) {
    throw new DomainError(
      "unavailable",
      `The app is connected as ${row?.role ?? "an unknown role"}; it must connect as ${APP_ROLE}. Set LEDGER_DATABASE_URL.`,
    );
  }
}
