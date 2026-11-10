import { createHash, timingSafeEqual } from "node:crypto";
import { route } from "../../../../http/handler";
import { DomainError } from "../../../../ledger/errors";
import { ensureAppRole, getLedger } from "../../../../server/container";

export const maxDuration = 60;

function authorised(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = createHash("sha256").update(header ?? "").digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

// Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`.
export const GET = route({}, async ({ req }) => {
  if (!authorised(req.headers.get("authorization"))) {
    throw new DomainError("unauthorized", "A valid cron secret is required.");
  }
  await ensureAppRole();
  await getLedger().resetDemo();
  return { status: 200, body: { ok: true, accounts: 50, transactions: 500 } };
});
