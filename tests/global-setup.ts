import postgres from "postgres";
import { migrate } from "../scripts/migrate";
import { MAINTENANCE_URL, TEST_OWNER_URL } from "./support/constants";

export default async function globalSetup() {
  const admin = postgres(MAINTENANCE_URL, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    const found = await admin`select 1 from pg_database where datname = 'ledger_test'`;
    if (found.length === 0) await admin.unsafe("create database ledger_test");
  } catch (err) {
    throw new Error(`Cannot reach Postgres on 127.0.0.1:54329. Run \`pnpm db:up\` first. (${String(err)})`);
  } finally {
    await admin.end();
  }
  await migrate(TEST_OWNER_URL);
}
