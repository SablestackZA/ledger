import { route } from "../../../http/handler";
import { ensureAppRole, getDb } from "../../../server/container";

export const GET = route({}, async () => {
  try {
    await ensureAppRole();
    await getDb().query`select 1`;
    return { status: 200, body: { ok: true } };
  } catch {
    return { status: 503, body: { ok: false } };
  }
});
