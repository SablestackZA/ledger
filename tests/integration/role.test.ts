import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../../src/ledger/db";
import { assertAppRole } from "../../src/ledger/role";
import { app, cleanDatabase } from "../support/harness";
import { TEST_APP_URL, TEST_OWNER_URL } from "../support/constants";

cleanDatabase();

describe("assertAppRole", () => {
  it("passes for ledger_app and fails for the owner on a deployed environment", async () => {
    const asApp = createDb(TEST_APP_URL, { max: 1 });
    const asOwner = createDb(TEST_OWNER_URL, { max: 1 });
    try {
      await expect(assertAppRole(asApp, { VERCEL_ENV: "production" })).resolves.toBeUndefined();
      await expect(assertAppRole(asOwner, { VERCEL_ENV: "production" })).rejects.toMatchObject({ code: "unavailable" });
    } finally {
      await asApp.close();
      await asOwner.close();
    }
  });

  it("does nothing locally, where VERCEL_ENV is unset", async () => {
    const asOwner = createDb(TEST_OWNER_URL, { max: 1 });
    try {
      await expect(assertAppRole(asOwner, {})).resolves.toBeUndefined();
    } finally {
      await asOwner.close();
    }
  });
});

type Slot = typeof globalThis & { __ledger?: { db: { close(): Promise<void> } } };

describe("a deployed app connected as the owner", () => {
  const saved = { url: process.env.LEDGER_DATABASE_URL, env: process.env.VERCEL_ENV, container: (globalThis as Slot).__ledger };

  afterEach(async () => {
    await (globalThis as Slot).__ledger?.db.close();
    (globalThis as Slot).__ledger = saved.container;
    process.env.LEDGER_DATABASE_URL = saved.url;
    if (saved.env === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved.env;
    vi.resetModules();
  });

  it("answers /v1/health with 503 and refuses writes with 503, without crashing", async () => {
    delete (globalThis as Slot).__ledger;
    process.env.LEDGER_DATABASE_URL = TEST_OWNER_URL;
    process.env.VERCEL_ENV = "preview";
    vi.resetModules();
    const { GET: health } = await import("../../src/app/v1/health/route");
    const { POST: openAccount } = await import("../../src/app/v1/accounts/route");
    const { call } = await import("../support/harness");

    const h = await call(health, "/v1/health");
    expect(h).toMatchObject({ status: 503, body: { ok: false } });
    const w = await call(openAccount, "/v1/accounts", {
      method: "POST",
      auth: true,
      key: "k1",
      body: { code: "1", name: "x", type: "asset", currency: "ZAR" },
    });
    expect(w.status).toBe(503);
    expect(w.body.error.code).toBe("unavailable");
  });

  it("answers /v1/health with 200 when connected as ledger_app", async () => {
    delete (globalThis as Slot).__ledger;
    process.env.LEDGER_DATABASE_URL = TEST_APP_URL;
    process.env.VERCEL_ENV = "preview";
    vi.resetModules();
    const { GET: health } = await import("../../src/app/v1/health/route");
    const { call } = await import("../support/harness");
    expect(await call(health, "/v1/health")).toMatchObject({ status: 200, body: { ok: true } });
  });
});

describe("ledger_app role settings (migration 0002)", () => {
  it("carries the statement and idle-in-transaction timeouts", async () => {
    const [s] = await app`show statement_timeout`;
    const [i] = await app`show idle_in_transaction_session_timeout`;
    expect(s!.statement_timeout).toBe("5s");
    expect(i!.idle_in_transaction_session_timeout).toBe("10s");
  });
});
