interface CorsEvent {
  url: URL;
  req: { method: string };
}

export default async function tvCors(
  event: CorsEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url.pathname;
  const shared = path === "/version.json" || path.startsWith("/tv/");
  if (!shared) return next();
  if ((event.req.method ?? "GET").toUpperCase() === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "*",
      },
    });
  }
  const response = await next();
  if (response instanceof Response) {
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", "*");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
}
