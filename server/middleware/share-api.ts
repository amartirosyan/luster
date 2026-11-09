import { getRequestHeader, getRequestURL, readBody } from "h3";
import { handleShareRequest, shareCorsHeaders } from "../share-http.ts";

type Next = () => unknown | Promise<unknown>;

function header(event: unknown, name: string): string {
  const value = getRequestHeader(event as never, name);
  return value ? String(value) : "";
}

export default async function shareApi(event: { url?: URL; req?: { method?: string } }, next: Next) {
  const url = event.url ?? getRequestURL(event as never);
  const pathname = url.pathname || "";
  if (!pathname.startsWith("/api/share")) return next();
  const method = String(event.req?.method || "GET").toUpperCase();
  let body: unknown = {};
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    body = await readBody(event as never).catch(() => ({}));
  }
  const result = await handleShareRequest({
    method,
    pathname,
    searchParams: url.searchParams,
    header: (name) => header(event, name),
    body,
  });
  const headers = shareCorsHeaders();
  if (result.bytes) {
    headers["content-type"] = result.contentType || "image/jpeg";
    headers["cache-control"] = "private, no-store";
    return new Response(Buffer.from(result.bytes), { status: result.status, headers });
  }
  if (result.status === 204) return new Response(null, { status: 204, headers });
  return new Response(JSON.stringify(result.json ?? {}), {
    status: result.status,
    headers,
  });
}
