import { route } from "../../../../http/handler";
import { getLedger } from "../../../../server/container";

export const GET = route<{ id: string }>({}, async ({ params }) => ({
  status: 200,
  body: await getLedger().getTransaction(params.id),
}));
