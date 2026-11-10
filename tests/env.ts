import { createHash } from "node:crypto";
import { TEST_APP_URL, TEST_API_KEY } from "./support/constants";

process.env.DATABASE_URL = TEST_APP_URL;
process.env.LEDGER_DATABASE_URL = TEST_APP_URL;
delete process.env.VERCEL_ENV;
process.env.LEDGER_API_KEY_SHA256 = createHash("sha256").update(TEST_API_KEY).digest("hex");
process.env.CRON_SECRET = "test-cron-secret";
process.env.LEDGER_LOG ??= "silent";
