import { route } from "../../../http/handler";
import { idempotencyKey, openAccountSchema, pageQuery, readJson } from "../../../http/schemas";
import { getLedger } from "../../../server/container";

export const GET = route({}, async ({ req }) => ({ status: 200, body: await getLedger().listAccounts(pageQuery(req)) }));

export const POST = route({ auth: true }, async ({ req }) => {
  const key = idempotencyKey(req);
  const input = openAccountSchema.parse(await readJson(req));
  const { value, replayed } = await getLedger().openAccount(input, key);
  return replayed
    ? { status: 200, body: value, headers: { "idempotent-replayed": "true" } }
    : { status: 201, body: value };
});
