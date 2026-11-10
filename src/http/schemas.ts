import { z } from "zod";
import { DomainError, invalidRequest } from "../ledger/errors";

const currency = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO 4217 code in capitals.");

export const openAccountSchema = z.strictObject({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  type: z.enum(["asset", "liability", "equity", "income", "expense"]),
  currency,
});

const amountMinor = z
  .union([z.number().int(), z.string().regex(/^-?\d{1,19}$/, "Use an integer in minor units.")])
  .transform((v) => BigInt(v));

export const postTransactionSchema = z.strictObject({
  description: z.string().max(200).optional(),
  entries: z
    .array(z.strictObject({ account_id: z.uuid(), amount_minor: amountMinor, currency }))
    .min(2)
    .max(50),
});

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw invalidRequest("The request body is not valid JSON.");
  }
}

export function pageQuery(req: Request) {
  const params = new URL(req.url).searchParams;
  return pageQuerySchema.parse({
    limit: params.get("limit") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
  });
}

export function idempotencyKey(req: Request): string {
  const key = req.headers.get("idempotency-key");
  if (!key) throw new DomainError("invalid_request", "The Idempotency-Key header is required.");
  return key;
}
