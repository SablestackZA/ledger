import { route } from "../../../http/handler";
import { getLedger } from "../../../server/container";

// The scan is O(entries); the CDN absorbs repeat calls for 30 seconds.
export const GET = route({}, async () => ({
  status: 200,
  body: await getLedger().checkIntegrity(),
  headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" },
}));
