export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "unbalanced"
  | "currency_mismatch"
  | "unknown_account"
  | "idempotency_conflict"
  | "account_code_conflict"
  | "already_reversed"
  | "not_reversible"
  | "retry"
  | "unavailable";

// Domain errors carry a code and structured details; HTTP status lives only in http/errors.ts.
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const invalidRequest = (message: string, details?: Record<string, unknown>) =>
  new DomainError("invalid_request", message, details);

export const notFound = (what: string, id: string) =>
  new DomainError("not_found", `${what} ${id} does not exist.`);
