import { createHash, randomUUID } from "node:crypto";
import { verifyBearer } from "../auth/auth";
import { DomainError } from "../ledger/errors";
import { ensureAppRole } from "../server/container";
import { requestContext } from "../server/context";
import { log } from "../server/log";
import { mapError } from "./errors";

export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface RouteContext<P> {
  req: Request;
  params: P;
  requestId: string;
}

interface Options {
  auth?: boolean;
}

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function route<P = Record<string, never>>(opts: Options, fn: (ctx: RouteContext<P>) => Promise<Reply>) {
  return async (req: Request, ctx?: { params: Promise<P> }): Promise<Response> => {
    const started = performance.now();
    const incoming = req.headers.get("x-request-id");
    const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    let reply: Reply;
    let errorCode: string | undefined;
    try {
      if (opts.auth && !verifyBearer(req.headers.get("authorization"), process.env.LEDGER_API_KEY_SHA256)) {
        throw new DomainError("unauthorized", "A valid bearer API key is required for writes.");
      }
      if (opts.auth) await ensureAppRole();
      const params = (ctx ? await ctx.params : {}) as P;
      reply = await requestContext.run({ requestId }, () => fn({ req, params, requestId }));
    } catch (err) {
      const mapped = mapError(err);
      reply = mapped;
      errorCode = mapped.body.error.code;
      if (mapped.status >= 500 && errorCode === "internal") {
        log("error", { request_id: requestId, name: err instanceof Error ? err.name : "unknown", message: err instanceof Error ? err.message : String(err) });
      }
    }

    const key = req.headers.get("idempotency-key");
    log("request", {
      request_id: requestId,
      method: req.method,
      path: new URL(req.url).pathname,
      status: reply.status,
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
      ...(errorCode ? { error_code: errorCode } : {}),
      ...(key ? { idempotency_key_hash: createHash("sha256").update(key).digest("hex").slice(0, 8) } : {}),
    });

    return Response.json(reply.body, {
      status: reply.status,
      headers: { ...reply.headers, "x-request-id": requestId },
    });
  };
}
