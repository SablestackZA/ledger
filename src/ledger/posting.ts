import { createHash } from "node:crypto";
import { DomainError, invalidRequest } from "./errors";
import type { EntryInput, OpenAccountInput, PostTransactionInput } from "./types";

export const MIN_ENTRIES = 2;
export const MAX_ENTRIES = 50;
const CURRENCY = /^[A-Z]{3}$/;
const INT64_MAX = 9223372036854775807n;

export interface PreparedPosting {
  description: string | null;
  entries: EntryInput[];
  // Net movement per account, in the order the account ids sort (the lock order).
  accountIds: string[];
  deltas: bigint[];
  requestHash: Buffer;
}

// Pure. Throws a DomainError for anything to reject before a write.
export function preparePosting(input: PostTransactionInput): PreparedPosting {
  const { entries } = input;
  if (entries.length < MIN_ENTRIES || entries.length > MAX_ENTRIES) {
    throw invalidRequest(`A transaction needs ${MIN_ENTRIES} to ${MAX_ENTRIES} entries; got ${entries.length}.`);
  }

  const sums = new Map<string, bigint>();
  const byAccount = new Map<string, bigint>();
  for (const e of entries) {
    if (!CURRENCY.test(e.currency)) {
      throw invalidRequest(`Currency ${JSON.stringify(e.currency)} is not a 3-letter ISO 4217 code.`);
    }
    if (e.amount_minor === 0n) {
      throw invalidRequest("An entry amount cannot be zero.");
    }
    if (e.amount_minor > INT64_MAX || e.amount_minor < -INT64_MAX) {
      throw invalidRequest("An entry amount is outside the 64-bit range.");
    }
    sums.set(e.currency, (sums.get(e.currency) ?? 0n) + e.amount_minor);
    byAccount.set(e.account_id, (byAccount.get(e.account_id) ?? 0n) + e.amount_minor);
  }

  const unbalanced = [...sums].filter(([, sum]) => sum !== 0n);
  if (unbalanced.length > 0) {
    throw new DomainError("unbalanced", "Entries must sum to zero in each currency.", {
      sums: Object.fromEntries(unbalanced.map(([c, s]) => [c, s.toString()])),
    });
  }

  const accountIds = [...byAccount.keys()].sort();
  return {
    description: input.description ?? null,
    entries,
    accountIds,
    deltas: accountIds.map((id) => byAccount.get(id)!),
    requestHash: hashOf([input.description ?? null, entries.map((e) => [e.account_id, e.amount_minor.toString(), e.currency])]),
  };
}

export function hashAccount(input: OpenAccountInput): Buffer {
  return hashOf([input.code, input.name, input.type, input.currency]);
}

// Hash of the parsed request, not the raw bytes: `5` and `"5"` are the same request.
function hashOf(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value)).digest();
}
