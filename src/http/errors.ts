import { ZodError } from "zod";
import { DomainError, type ErrorCode } from "../ledger/errors";

export interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export interface MappedError {
  status: number;
  body: ErrorBody;
  headers?: Record<string, string>;
}

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 422,
  unauthorized: 401,
  not_found: 404,
  unbalanced: 422,
  currency_mismatch: 422,
  unknown_account: 422,
  idempotency_conflict: 409,
  account_code_conflict: 409,
  already_reversed: 409,
  not_reversible: 409,
  retry: 503,
  unavailable: 503,
};

// Conditions meaning the database is slow, full or away (§8).
const UNAVAILABLE_PG = new Set(["57014", "57P01", "57P03", "53300", "53200", "25P03", "40P01", "08000", "08003", "08006"]);
const UNAVAILABLE_DRIVER = new Set([
  "CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
]);

function body(code: string, message: string, details?: Record<string, unknown>): ErrorBody {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

// The only place a thrown value becomes a status code.
export function mapError(err: unknown): MappedError {
  if (err instanceof DomainError) {
    const headers: Record<string, string> = {};
    if (err.code === "unauthorized") headers["www-authenticate"] = "Bearer";
    if (err.code === "retry" || err.code === "unavailable") headers["retry-after"] = "1";
    return { status: STATUS[err.code], body: body(err.code, err.message, err.details), headers };
  }
  if (err instanceof ZodError) {
    return {
      status: 422,
      body: body("invalid_request", "The request body or query is not valid.", {
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
    };
  }
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  if (code === "22003") {
    return { status: 422, body: body("invalid_request", "An amount or balance is outside the 64-bit range.") };
  }
  if (UNAVAILABLE_PG.has(code) || UNAVAILABLE_DRIVER.has(code)) {
    return { status: 503, body: body("unavailable", "The database is unavailable. Retry shortly."), headers: { "retry-after": "1" } };
  }
  return { status: 500, body: body("internal", "Unexpected error. Quote the x-request-id header when reporting it.") };
}
