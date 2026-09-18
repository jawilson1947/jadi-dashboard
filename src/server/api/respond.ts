import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ForbiddenError, UnauthenticatedError } from "../authz/permissions";
import { DataSourceUnavailableError } from "../repositories/types";
import { newCorrelationId } from "../audit/audit";
import { IdentityError } from "../identity/types";

/**
 * Consistent JSON envelope and error objects with correlation IDs (Spec §17).
 * Never leaks SQL, connection details, or stack traces.
 */
export interface ApiMeta {
  correlationId: string;
  [k: string]: string | number | boolean | null | undefined;
}

export function ok<T>(data: T, meta: Partial<ApiMeta> = {}, init?: ResponseInit) {
  return NextResponse.json({ data, meta: { correlationId: meta.correlationId ?? newCorrelationId(), ...meta } }, init);
}

export function fail(status: number, code: string, message: string, correlationId = newCorrelationId()) {
  return NextResponse.json({ error: { code, message, correlationId } }, { status });
}

/**
 * CSRF guard for state-changing requests (Spec §18): cookies are SameSite=Lax, and in addition a
 * cross-site POST/PATCH/DELETE is rejected when the browser tells us so (Sec-Fetch-Site) or when an
 * Origin header is present that does not match the request host.
 */
export function isSameOrigin(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser client or same-origin without Origin
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/** Wrap a handler so every thrown error becomes a safe, consistent response. */
export function handle(fn: (req: Request, ctx: { correlationId: string }) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const correlationId = req.headers.get("x-correlation-id") ?? newCorrelationId();
    if (!isSameOrigin(req)) return fail(403, "cross_origin", "Cross-origin requests are not allowed.", correlationId);
    try {
      const res = await fn(req, { correlationId });
      res.headers.set("x-correlation-id", correlationId);
      return res;
    } catch (err) {
      if (err instanceof UnauthenticatedError) return fail(401, "unauthenticated", "Sign in to continue.", correlationId);
      if (err instanceof ForbiddenError) return fail(403, "forbidden", "You do not have permission to perform this action.", correlationId);
      if (err instanceof ZodError) return fail(400, "invalid_request", "The request was not valid.", correlationId);
      if (err instanceof IdentityError) return fail(err.status, err.code, err.message, correlationId);
      if (err instanceof DataSourceUnavailableError) return fail(503, "source_unavailable", "The data source is unavailable.", correlationId);
      console.error(JSON.stringify({ level: "error", correlationId, message: err instanceof Error ? err.message : String(err) }));
      return fail(500, "internal_error", "An unexpected error occurred.", correlationId);
    }
  };
}
