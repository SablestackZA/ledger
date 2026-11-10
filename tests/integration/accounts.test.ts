import { describe, expect, it } from "vitest";
import { GET as getAccount } from "../../src/app/v1/accounts/[id]/route";
import { GET as listEntries } from "../../src/app/v1/accounts/[id]/entries/route";
import { GET as listAccounts, POST as openAccount } from "../../src/app/v1/accounts/route";
import { call, cleanDatabase } from "../support/harness";
import { openAccount as open, transfer } from "../support/fixtures";

cleanDatabase();

const body = { code: "1000", name: "Cash", type: "asset", currency: "ZAR" };
const post = (o: Parameters<typeof call>[2]) => call(openAccount, "/v1/accounts", { method: "POST", ...o });

describe("POST /v1/accounts", () => {
  it("opens an account with a zero balance", async () => {
    const res = await post({ auth: true, key: "k1", body });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: "1000", name: "Cash", type: "asset", currency: "ZAR", balance_minor: "0", version: 0 });
    expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("replays the same key and body with 200 and the original account", async () => {
    const first = await post({ auth: true, key: "k1", body });
    const again = await post({ auth: true, key: "k1", body });
    expect(again.status).toBe(200);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body).toEqual(first.body);
  });

  it("returns 409 idempotency_conflict for the same key with a different body", async () => {
    await post({ auth: true, key: "k1", body });
    const res = await post({ auth: true, key: "k1", body: { ...body, name: "Other" } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("idempotency_conflict");
  });

  it("returns 409 account_code_conflict for a reused code under a new key", async () => {
    await post({ auth: true, key: "k1", body });
    const res = await post({ auth: true, key: "k2", body });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("account_code_conflict");
  });

  it("requires the bearer key", async () => {
    const none = await post({ key: "k1", body });
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe("Bearer");
    expect((await post({ auth: "wrong", key: "k1", body })).status).toBe(401);
  });

  it("requires an Idempotency-Key header", async () => {
    const res = await post({ auth: true, body });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("invalid_request");
  });

  it("rejects an invalid body with the failing paths", async () => {
    const res = await post({ auth: true, key: "k1", body: { ...body, currency: "zar", type: "cash" } });
    expect(res.status).toBe(422);
    expect(res.body.error.details.issues.map((i: { path: string }) => i.path).sort()).toEqual(["currency", "type"]);
  });
});

describe("GET /v1/accounts", () => {
  it("is public and pages by cursor in code order", async () => {
    for (const c of ["a", "b", "c", "d", "e"]) await open(c);
    const p1 = await call(listAccounts, "/v1/accounts", { query: "?limit=2" });
    expect(p1.status).toBe(200);
    expect(p1.body.data.map((a: { code: string }) => a.code)).toEqual(["a", "b"]);
    const p2 = await call(listAccounts, "/v1/accounts", { query: `?limit=2&cursor=${p1.body.next_cursor}` });
    expect(p2.body.data.map((a: { code: string }) => a.code)).toEqual(["c", "d"]);
    const p3 = await call(listAccounts, "/v1/accounts", { query: `?limit=2&cursor=${p2.body.next_cursor}` });
    expect(p3.body.data.map((a: { code: string }) => a.code)).toEqual(["e"]);
    expect(p3.body.next_cursor).toBeNull();
  });

  it("rejects a limit over 100 and a bad cursor", async () => {
    expect((await call(listAccounts, "/v1/accounts", { query: "?limit=101" })).status).toBe(422);
    expect((await call(listAccounts, "/v1/accounts", { query: "?cursor=***" })).status).toBe(422);
  });
});

describe("GET /v1/accounts/{id}", () => {
  it("returns the account", async () => {
    const a = await open("1000");
    const res = await call(getAccount, `/v1/accounts/${a.id}`, { params: { id: a.id } });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(a.id);
  });
  it("returns 404 for an unknown or malformed id", async () => {
    for (const id of ["018f0000-0000-7000-8000-0000000000ff", "not-a-uuid"]) {
      const res = await call(getAccount, `/v1/accounts/${id}`, { params: { id } });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
    }
  });
});

describe("GET /v1/accounts/{id}/entries", () => {
  it("lists entries newest first with a cursor", async () => {
    const a = await open("a");
    const b = await open("b");
    for (let i = 1; i <= 3; i++) await transfer(a.id, b.id, i * 100, `t${i}`);
    const p1 = await call(listEntries, "", { query: "?limit=2", params: { id: b.id } });
    expect(p1.status).toBe(200);
    expect(p1.body.data.map((e: { amount_minor: string }) => e.amount_minor)).toEqual(["300", "200"]);
    const p2 = await call(listEntries, "", { query: `?limit=2&cursor=${p1.body.next_cursor}`, params: { id: b.id } });
    expect(p2.body.data.map((e: { amount_minor: string }) => e.amount_minor)).toEqual(["100"]);
    expect(p2.body.next_cursor).toBeNull();
  });
  it("returns 404 for an unknown account", async () => {
    const id = "018f0000-0000-7000-8000-0000000000ff";
    expect((await call(listEntries, "", { params: { id } })).status).toBe(404);
  });
});

describe("POST /v1/accounts under concurrency", () => {
  it("20 simultaneous requests with one key and body yield one 201, the rest 200 replays, one account", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => post({ auth: true, key: "same", body })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(19);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    const list = await call(listAccounts, "/v1/accounts");
    expect(list.body.data).toHaveLength(1);
  });

  it("20 simultaneous requests with one key but different bodies never produce a 500", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => post({ auth: true, key: "same", body: { ...body, code: `c${i % 2}`, name: `n${i % 2}` } })),
    );
    const statuses = new Set(results.map((r) => r.status));
    expect([...statuses].every((s) => [200, 201, 409].includes(s))).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });
});
