import { route } from "../../../../../http/handler";
import { getLedger } from "../../../../../server/container";

export const POST = route<{ id: string }>({ auth: true }, async ({ params }) => ({
  status: 201,
  body: await getLedger().reverseTransaction(params.id),
}));
