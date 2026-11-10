import { systemClock } from "../src/ledger/clock";
import { createDb } from "../src/ledger/db";
import { seedAccounts } from "../src/ledger/seed";
import { LedgerService } from "../src/ledger/service";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local is optional
}

const url = process.env.LEDGER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Set LEDGER_DATABASE_URL (or DATABASE_URL).");
  process.exit(1);
}
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  console.error("Refusing to seed a non-local database.");
  process.exit(1);
}
const count = Number(process.argv[2] ?? 1000);

const db = createDb(url, { max: 4 });
try {
  const ids = await seedAccounts(new LedgerService({ db, clock: systemClock }), count);
  console.log(`seeded ${ids.length} accounts (ZAR)`);
} finally {
  await db.close();
}
