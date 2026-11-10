import { requestContext } from "./context";

// One JSON object per line. Never pass a key, a body, or an Authorization header in here.
export function log(event: string, fields: Record<string, unknown> = {}): void {
  if (process.env.LEDGER_LOG === "silent") return;
  const requestId = requestContext.getStore()?.requestId;
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...(requestId ? { request_id: requestId } : {}), ...fields }));
}
