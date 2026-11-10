import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { mapError } from "../../src/http/errors";
import { DomainError, type ErrorCode } from "../../src/ledger/errors";

describe("mapError", () => {
  const cases: [ErrorCode, number][] = [
    ["invalid_request", 422],
    ["unbalanced", 422],
    ["currency_mismatch", 422],
    ["unknown_account", 422],
    ["unauthorized", 401],
    ["not_found", 404],
    ["idempotency_conflict", 409],
    ["account_code_conflict", 409],
    ["already_reversed", 409],
    ["not_reversible", 409],
    ["retry", 503],
    ["unavailable", 503],
  ];
  it.each(cases)("maps %s to %i", (code, status) => {
    const m = mapError(new DomainError(code, "m", { a: 1 }));
    expect(m.status).toBe(status);
    expect(m.body).toEqual({ error: { code, message: "m", details: { a: 1 } } });
  });

  it("maps database slowness and absence to 503 unavailable", () => {
    for (const code of ["57014", "CONNECT_TIMEOUT", "ECONNREFUSED", "53300"]) {
      expect(mapError(Object.assign(new Error("x"), { code })).body.error.code).toBe("unavailable");
    }
  });

  it("maps a numeric overflow to 422", () => {
    expect(mapError(Object.assign(new Error("x"), { code: "22003" })).status).toBe(422);
  });

  it("maps a zod failure to 422 with the failing paths", () => {
    const err = new ZodError([{ code: "custom", path: ["entries", 0], message: "bad", input: null }]);
    const m = mapError(err);
    expect(m.status).toBe(422);
    expect(m.body.error.details).toEqual({ issues: [{ path: "entries.0", message: "bad" }] });
  });

  it("hides the message of an unknown error", () => {
    const m = mapError(new Error("secret internals"));
    expect(m.status).toBe(500);
    expect(JSON.stringify(m.body)).not.toContain("secret internals");
  });
});
