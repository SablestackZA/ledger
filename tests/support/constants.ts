// Fixtures for the throwaway docker database only; not credentials for anything.
const base = "postgres://%USER%@127.0.0.1:54329/ledger_test";
export const TEST_APP_URL = base.replace("%USER%", "ledger_app");
export const TEST_OWNER_URL = base.replace("%USER%", "ledger");
export const MAINTENANCE_URL = "postgres://ledger@127.0.0.1:54329/postgres";
export const TEST_API_KEY = "test-api-key-not-a-secret";
