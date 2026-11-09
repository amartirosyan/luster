import { appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";
// @ts-expect-error JS plugin alongside the TS vite config
import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";
import { isMigrationFile } from "./scripts/migration-plan.mjs";
import { claimPhonePair, markPhonePairOpened, newPair, readPhonePair } from "./server/pair-store";
import { handleShareRequest, shareCorsHeaders } from "./server/share-http";

const pickerLists = new Map<string, { state: string; body: string }>();

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.end(JSON.stringify(body));
}

function pickerProxyPlugin(): Plugin {
  return {
    name: "picker-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url || "";
        const path = raw.split("?")[0];
        if (path.startsWith("/api/share")) {
          for (const [key, value] of Object.entries(shareCorsHeaders())) {
            if (key === "content-type") continue;
            res.setHeader(key, value);
          }
          if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
          }
          let payload: unknown = {};
          if (req.method && req.method !== "GET" && req.method !== "HEAD") {
            const rawBody = await readRequestBody(req);
            try {
              payload = JSON.parse(rawBody || "{}");
            } catch {
              payload = {};
            }
          }
          const incoming = new URL(raw, "http://localhost");
          const result = await handleShareRequest({
            method: req.method || "GET",
            pathname: path,
            searchParams: incoming.searchParams,
            header: (name) => {
              const value = req.headers[name.toLowerCase()];
              return Array.isArray(value) ? String(value[0] || "") : String(value || "");
            },
            body: payload,
          });
          if (result.bytes) {
            res.statusCode = result.status;
            res.setHeader("Content-Type", result.contentType || "image/jpeg");
            res.setHeader("Cache-Control", "private, no-store");
            res.end(Buffer.from(result.bytes));
            return;
          }
          sendJson(res, result.status, result.json ?? {});
          return;
        }
        if (path === "/api/pair" || path === "/api/pair/claim" || path === "/api/pair/open") {
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
          if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
          }
        }
        if (req.method === "POST" && path === "/api/pair") {
          const rawBody = await readRequestBody(req);
          let payload: { purpose?: string; tvId?: string } = {};
          try {
            payload = rawBody ? JSON.parse(rawBody) : {};
          } catch {
            payload = {};
          }
          try {
            sendJson(res, 200, { id: await newPair(payload) });
          } catch (err) {
            const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
            sendJson(res, status, { error: err instanceof Error ? err.message : "Could not make a code." });
          }
          return;
        }
        if (req.method === "POST" && path === "/api/pair/open") {
          const rawBody = await readRequestBody(req);
          let payload: { id?: string } = {};
          try {
            payload = JSON.parse(rawBody || "{}");
          } catch {
            payload = {};
          }
          const id = String(payload.id || "");
          if (!id) {
            sendJson(res, 400, { error: "Missing code." });
            return;
          }
          const result = await markPhonePairOpened(id);
          sendJson(res, result.error ? 404 : 200, result);
          return;
        }
        if (req.method === "POST" && path === "/api/pair/claim") {
          const rawBody = await readRequestBody(req);
          let payload: { id?: string; token?: string; expiresIn?: number } = {};
          try {
            payload = JSON.parse(rawBody || "{}");
          } catch {
            payload = {};
          }
          const id = String(payload.id || "");
          const token = String(payload.token || "");
          if (!id || !token) {
            sendJson(res, 400, { error: "Missing sign-in." });
            return;
          }
          try {
            sendJson(res, 200, await claimPhonePair(id, token, Number(payload.expiresIn) || 3600));
          } catch {
            sendJson(res, 502, { error: "Could not reach Google Photos." });
          }
          return;
        }
        if (req.method === "GET" && path === "/api/pair") {
          const incoming = new URL(raw, "http://localhost");
          const cb = incoming.searchParams.get("cb") || "";
          const body = incoming.searchParams.get("new") === "1"
            ? { id: await newPair() }
            : await readPhonePair(incoming.searchParams.get("id") || "");
          if (/^nlPair[A-Za-z0-9]+$/.test(cb)) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/javascript; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(`${cb}(${JSON.stringify(body)})`);
            return;
          }
          sendJson(res, 200, body);
          return;
        }
        if (req.method === "GET" && path === "/api/picker/list") {
          const incoming = new URL(raw, "http://localhost");
          const sessionId = incoming.searchParams.get("sessionId") || "";
          const pageToken = incoming.searchParams.get("pageToken") || "";
          const token = incoming.searchParams.get("token") || readCookie(req.headers.cookie, "nl_picker_token");
          const key = `${sessionId}:${pageToken}`;
          const sendPart = (index: number, slice: string, total: number) => {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/javascript; charset=utf-8");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Cache-Control", "no-store");
            res.end(`globalThis.__nlPickerPart(${index},${JSON.stringify(slice)},${total});`);
          };
          if (!sessionId) {
            sendPart(0, JSON.stringify({ error: { message: "Missing session" } }), 1);
            return;
          }
          let job = pickerLists.get(key);
          if (!job) {
            job = { state: "pending", body: "" };
            pickerLists.set(key, job);
            const query = new URLSearchParams({ sessionId, pageSize: "100" });
            if (pageToken) query.set("pageToken", pageToken);
            const target = `https://photospicker.googleapis.com/v1/mediaItems?${query}`;
            fetch(target, {
              headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                Accept: "application/json",
              },
            }).then(async (upstream) => {
              const body = Buffer.from(await upstream.arrayBuffer());
              job.state = "done";
              job.body = body.toString("utf8");
              try {
                appendFileSync(
                  "/tmp/picker-list.log",
                  `${new Date().toISOString()} token:${token ? "yes" : "no"} ${upstream.status} ${body.length} ${body.subarray(0, 180).toString("utf8").replace(/\s+/g, " ")}\n`,
                );
              } catch {
                /* logging must not block the photo list */
              }
            }).catch((err) => {
              job.state = "done";
              job.body = JSON.stringify({ error: { message: err instanceof Error ? err.message : String(err) } });
            });
          }
          const size = 1200;
          if (job.state !== "done") {
            sendPart(-1, "", 0);
            return;
          }
          const total = Math.max(1, Math.ceil(job.body.length / size));
          const requested = Number(incoming.searchParams.get("part") || "0");
          const index = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), total - 1) : 0;
          sendPart(index, job.body.slice(index * size, index * size + size), total);
          return;
        }
        if (req.method === "POST" && path === "/api/picker/list") {
          const rawBody = await readRequestBody(req);
          let payload: { sessionId?: string; pageToken?: string; token?: string } = {};
          try {
            payload = JSON.parse(rawBody || "{}");
          } catch {
            payload = {};
          }
          const query = new URLSearchParams({ sessionId: String(payload.sessionId || "") });
          if (payload.pageToken) query.set("pageToken", String(payload.pageToken));
          const target = `https://photospicker.googleapis.com/v1/mediaItems?${query}`;
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          try {
            const upstream = await fetch(target, {
              headers: {
                ...(payload.token ? { Authorization: `Bearer ${payload.token}` } : {}),
                Accept: "application/json",
              },
              signal: ctrl.signal,
            });
            const body = Buffer.from(await upstream.arrayBuffer());
            res.statusCode = upstream.status;
            res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
            res.end(body);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            res.statusCode = 504;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: message }));
          } finally {
            clearTimeout(timer);
          }
          return;
        }
        if (!raw.startsWith("/api/picker/")) {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        const headerToken = String(req.headers["x-google-token"] || "");
        const authorization = headerToken
          ? `Bearer ${headerToken}`
          : String(req.headers.authorization || "");
        const target = `https://photospicker.googleapis.com/v1/${raw.slice("/api/picker/".length)}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const upstream = await fetch(target, {
            method: req.method || "GET",
            headers: {
              ...(authorization ? { Authorization: authorization } : {}),
              Accept: "application/json",
            },
            signal: ctrl.signal,
          });
          const body = Buffer.from(await upstream.arrayBuffer());
          res.statusCode = upstream.status;
          res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
          res.end(body);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.statusCode = 504;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message }));
        } finally {
          clearTimeout(timer);
        }
      });
    },
  };
}

function readCookie(header: string | undefined, name: string): string {
  const raw = String(header || "");
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1));
    } catch {
      return part.slice(eq + 1);
    }
  }
  return "";
}

function readRequestBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** The files `src/lib/db.ts` globs — same directory, same non-recursive scope. */
function hasGlobbedMigrations(root: string): boolean {
  try {
    return readdirSync(join(root, "migrations")).some(isMigrationFile);
  } catch {
    return false;
  }
}

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 *
 * Vite awaiting the hook puts this on time-to-first-render, so an app with no
 * migrations — no schema to apply — skips it entirely rather than paying for a
 * PGLite instance it never queries.
 */
function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "app-builder:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      if (!hasGlobbedMigrations(server.config.root)) return;
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[app-builder] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

/**
 * Live-preview OAuth popup — handled HERE so the agent never has to create a
 * `/auth/popup` route (and cannot break it by scaffolding a React page that
 * paints the full app shell in the popup).
 *
 * `signIn` (client.ts) opens `/auth/popup?providerId=…` in a top-level window.
 * This middleware runs before TanStack Start, calls `handleAuthPopupRequest`,
 * and returns the 302 / completion HTML. Deployed apps do not use the popup
 * (full-page OAuth redirect), so `apply: "serve"` is enough.
 */
function authPopupPlugin(): Plugin {
  return {
    name: "app-builder:auth-popup",
    apply: "serve",
    configureServer(server) {
      // Register immediately (not in a returned post-hook) so we run BEFORE
      // TanStack Start / the SPA HTML fallback. A model-authored
      // `src/routes/auth/popup.tsx` React page must never win this path.
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/auth/popup") {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }

          const host = String(
            req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:8080",
          );
          const proto = String(
            req.headers["x-forwarded-proto"] ??
              ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http"),
          );
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          // Ensure Host is the public preview host so Better Auth's dynamic
          // baseURL / redirect_uri match the popup origin.
          if (!requestHeaders.has("host")) requestHeaders.set("host", host);

          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method: "GET",
            headers: requestHeaders,
          });

          const mod = (await server.ssrLoadModule("/src/lib/auth/popup.server.ts")) as {
            handleAuthPopupRequest: (req: Request) => Promise<Response>;
          };
          const response = await mod.handleAuthPopupRequest(request);

          res.statusCode = response.status;
          // Preserve multiple Set-Cookie headers (OAuth state + session).
          const setCookies =
            typeof response.headers.getSetCookie === "function"
              ? response.headers.getSetCookie()
              : [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });
          for (const cookie of setCookies) {
            res.appendHeader("set-cookie", cookie);
          }
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (err) {
          console.error("[app-builder] /auth/popup handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("auth popup failed");
          }
        }
      });
    },
  };
}

// `0.0.0.0:8080` is the live-preview contract — don't change host/port.
// The dev server starts once `src/router.tsx` and `src/routes/` exist — see
// AGENTS.md § "First scaffold".
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    pickerProxyPlugin(),
    pgliteBootstrapPlugin(),
    // Before tanstackStart so /auth/popup never falls through to the SPA.
    authPopupPlugin(),
    // Dev-only /__app-env, read by scripts/check-auth-invariant.mjs.
    appEnvPlugin(),
    // PWA head + ?install=1 tutorial page; runs before Start/Nitro.
    grokPwaPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            preset: "vercel",
            // Auto-registers server/middleware/* (the PWA install page +
            // manifest + head-tag middleware). Nitro v3 defaults serverDir to
            // false, so removing this silently unwires /?install=1 on deploys.
            serverDir: "./server",
          }),
        ]
      : []),
    viteReact(),
  ],
}));
