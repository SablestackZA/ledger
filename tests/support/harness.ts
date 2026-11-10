import postgres from "postgres";
import { afterAll, beforeEach } from "vitest";
import { getDb } from "../../src/server/container";
import { TEST_API_KEY, TEST_APP_URL, TEST_OWNER_URL } from "./constants";

export const owner = postgres(TEST_OWNER_URL, { max: 2, onnotice: () => {} });
export const app = postgres(TEST_APP_URL, { max: 2, onnotice: () => {} });

type Handler = (req: Request, ctx?: { params: Promise<never> }) => Promise<Response>;

// Response bodies are untyped JSON; tests assert on their shape directly.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Reply<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

interface CallOptions {
  method?: string;
  query?: string;
  body?: unknown;
  key?: string;
  auth?: boolean | string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
}

export async function call<T = any>(handler: Handler, path: string, o: CallOptions = {}): Promise<Reply<T>> {
  const headers: Record<string, string> = { ...o.headers };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.key) headers["idempotency-key"] = o.key;
  if (o.auth !== false && o.auth !== undefined) {
    headers.authorization = `Bearer ${typeof o.auth === "string" ? o.auth : TEST_API_KEY}`;
  }
  const req = new Request(`http://ledger.test${path}${o.query ?? ""}`, {
    method: o.method ?? "GET",
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const res = await handler(req, o.params ? { params: Promise.resolve(o.params as never) } : undefined);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
export function cleanDatabase() {
  beforeEach(async () => {
    await owner`truncate entries, transactions, accounts restart identity`;
  });
  afterAll(async () => {
    await getDb().close();
    await owner.end();
    await app.end();
  });
}
