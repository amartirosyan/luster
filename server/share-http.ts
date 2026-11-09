import { HttpError } from "./google-picker.ts";
import { getShareStore, type ShareStore } from "./share-store.ts";

export type ShareResult = {
  status: number;
  json?: unknown;
  bytes?: Uint8Array;
  contentType?: string;
};

export type ShareRequest = {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  header(name: string): string;
  body: unknown;
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Content-Type, Accept, X-Lustre-Owner, X-Lustre-Member, X-Lustre-Tv",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
};

export function shareCorsHeaders(): Record<string, string> {
  return { ...JSON_HEADERS };
}

function owner(req: ShareRequest): string {
  return req.header("x-lustre-owner");
}

function member(req: ShareRequest): { tvId: string; token: string } {
  return { tvId: req.header("x-lustre-tv"), token: req.header("x-lustre-member") };
}

function isPhotoBody(value: unknown): value is { bytes: Uint8Array; mime?: string } {
  return Boolean(value && typeof value === "object" && "bytes" in value && value.bytes instanceof Uint8Array);
}

function bag(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export async function handleShare(store: ShareStore, req: ShareRequest): Promise<ShareResult> {
  const method = req.method.toUpperCase();
  if (method === "OPTIONS") return { status: 204, json: {} };
  try {
    const path = req.pathname.replace(/\/+$/, "") || "/";
    const parts = path.split("/").filter(Boolean);
    if (parts[0] !== "api" || parts[1] !== "share") {
      return { status: 404, json: { error: "Not found." } };
    }
    const tail = parts.slice(2);
    const result = await route(store, method, tail, req);
    if (isPhotoBody(result)) {
      return { status: 200, bytes: result.bytes, contentType: result.mime || "image/jpeg" };
    }
    return { status: 200, json: result ?? { ok: true } };
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Could not update the shared album.";
    return { status, json: { error: status === 500 ? "Could not update the shared album." : message } };
  }
}

async function route(store: ShareStore, method: string, tail: string[], req: ShareRequest): Promise<unknown> {
  const body = bag(req.body);
  if (method === "POST" && tail.length === 1 && tail[0] === "albums") {
    return store.createAlbum(owner(req), String(body.name || ""));
  }
  if (method === "GET" && tail.length === 1 && tail[0] === "albums") {
    return { albums: await store.listAlbums(owner(req)) };
  }
  if (method === "POST" && tail.length === 1 && tail[0] === "join") {
    return store.join(String(body.code || ""), String(body.tvId || ""));
  }
  if (method === "POST" && tail.length === 1 && tail[0] === "leave") {
    const auth = member(req);
    return store.leave(String(body.albumId || ""), auth.tvId, auth.token);
  }
  if (method === "POST" && tail.length === 1 && tail[0] === "attach") {
    return store.attach(owner(req), String(body.pairId || ""), String(body.albumId || ""));
  }
  if (method === "GET" && tail.length === 1 && tail[0] === "sync") {
    const auth = member(req);
    const revision = Number(req.searchParams.get("rev"));
    return store.sync(
      req.searchParams.get("album") || "",
      auth.tvId,
      auth.token,
      Number.isFinite(revision) ? revision : -1,
    );
  }
  if (method === "GET" && tail[0] === "photos" && tail[1]) {
    const auth = member(req);
    return store.readPhoto(decodeURIComponent(tail[1]), auth.tvId, auth.token);
  }
  if (tail[0] === "albums" && tail[1]) {
    const albumId = decodeURIComponent(tail[1]);
    if (method === "GET" && tail.length === 2) return store.getAlbum(owner(req), albumId);
    if (method === "DELETE" && tail.length === 2) return store.deleteAlbum(owner(req), albumId);
    if (method === "POST" && tail[2] === "rename") return store.renameAlbum(owner(req), albumId, String(body.name || ""));
    if (method === "POST" && tail[2] === "join-code") return store.rotateJoinCode(owner(req), albumId);
    if (method === "POST" && tail[2] === "picker") {
      return store.startPicker(owner(req), albumId, String(body.token || ""), Number(body.expiresIn) || 3600);
    }
    if (method === "POST" && tail[2] === "tick") return store.tick(owner(req), albumId);
    if (method === "POST" && tail[2] === "revoke") return store.revokeTv(owner(req), albumId, String(body.tvId || ""));
    if (method === "DELETE" && tail[2] === "photos" && tail[3]) {
      return store.removePhoto(owner(req), albumId, decodeURIComponent(tail[3]));
    }
  }
  throw new HttpError(404, "Not found.");
}

export async function handleShareRequest(req: ShareRequest): Promise<ShareResult> {
  return handleShare(await getShareStore(), req);
}
