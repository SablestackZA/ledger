import { route } from "../../../../../http/handler";
import { pageQuery } from "../../../../../http/schemas";
import { getLedger } from "../../../../../server/container";

export const GET = route<{ id: string }>({}, async ({ req, params }) => ({
  status: 200,
  body: await getLedger().listAccountEntries(params.id, pageQuery(req)),
}));
