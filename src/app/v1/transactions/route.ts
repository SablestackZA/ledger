import { route } from "../../../http/handler";
import { idempotencyKey, pageQuery, postTransactionSchema, readJson } from "../../../http/schemas";
import { getLedger } from "../../../server/container";

export const GET = route({}, async ({ req }) => ({ status: 200, body: await getLedger().listTransactions(pageQuery(req)) }));

export const POST = route({ auth: true }, async ({ req }) => {
  const key = idempotencyKey(req);
  const input = postTransactionSchema.parse(await readJson(req));
  const { value, replayed, dbMs } = await getLedger().postTransaction(input, key);
  const timing = { db: dbMs };
  return replayed
    ? { status: 200, body: value, headers: { "idempotent-replayed": "true" }, timing }
    : { status: 201, body: value, timing };
});
