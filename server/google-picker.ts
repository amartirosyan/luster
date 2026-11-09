export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type PickedItem = {
  id: string;
  baseUrl: string;
  mimeType: string;
  filename: string;
  createTime: string;
  type: string;
};

type FetchLike = typeof fetch;

const API = "https://photospicker.googleapis.com/v1";
const SIZES = ["w1600-h1600", "w1200-h1200", "w800-h800"];

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function sessionIdOf(created: { id?: string; pickerUri?: string }): string {
  const direct = String(created.id || "").replace(/^sessions\//, "");
  if (direct) return direct;
  try {
    const parts = new URL(String(created.pickerUri || "")).pathname.split("/").filter(Boolean);
    const at = parts.lastIndexOf("session");
    if (at >= 0) return decodeURIComponent(parts[at + 1] || "");
  } catch {
    /* the create response id is enough */
  }
  return "";
}

export function pickerReady(body: Record<string, unknown> | null): boolean {
  if (!body) return false;
  const flag = body.mediaItemsSet ?? body.media_items_set;
  return flag === true || flag === "true";
}

export function normalizePicked(item: Record<string, unknown>): PickedItem {
  const file = (item.mediaFile || {}) as Record<string, unknown>;
  return {
    id: String(item.id || ""),
    baseUrl: String(file.baseUrl || item.baseUrl || ""),
    mimeType: String(file.mimeType || item.mimeType || ""),
    filename: String(file.filename || item.filename || "Photo"),
    createTime: String(item.createTime || item.create_time || ""),
    type: String(item.type || ""),
  };
}

export function isStillImage(item: PickedItem): boolean {
  if (!item.id || !item.baseUrl) return false;
  const mime = item.mimeType || "";
  if (mime.startsWith("video/") || item.type === "VIDEO") return false;
  if (mime && !mime.startsWith("image/")) return false;
  return true;
}

export async function createPickerSession(fetchImpl: FetchLike, token: string): Promise<{ id: string; pickerUri: string }> {
  const res = await fetchImpl(`${API}/sessions`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: "{}",
  });
  const data = await readJson(res);
  if (!res.ok) throw new HttpError(502, "Could not reach Google Photos.");
  const pickerUri = String(data.pickerUri || data.picker_uri || "");
  if (!pickerUri.startsWith("https://")) throw new HttpError(502, "Google did not return a picker link.");
  const host = new URL(pickerUri).hostname;
  if (host !== "photos.google.com" && !host.endsWith(".google.com")) {
    throw new HttpError(502, "Unexpected picker link.");
  }
  const id = sessionIdOf({ id: String(data.id || ""), pickerUri });
  if (!id) throw new HttpError(502, "Google did not return a selection id.");
  return { id, pickerUri };
}

export async function pickerSessionReady(fetchImpl: FetchLike, token: string, sessionId: string): Promise<boolean> {
  const res = await fetchImpl(`${API}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: authHeaders(token),
  });
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(401, "The Google sign-in expired. Add the photos again.");
  }
  if (!res.ok) throw new HttpError(502, "Could not reach Google Photos.");
  return pickerReady(await readJson(res));
}

export async function listPickedItems(fetchImpl: FetchLike, token: string, sessionId: string): Promise<PickedItem[]> {
  const items: PickedItem[] = [];
  let pageToken = "";
  const seen = new Set<string>();
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ sessionId, pageSize: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const res = await fetchImpl(`${API}/mediaItems?${query}`, { headers: authHeaders(token) });
    const data = await readJson(res);
    if (!res.ok) throw new HttpError(502, "Could not load the photo list.");
    const batch = (data.mediaItems || data.media_items || []) as Record<string, unknown>[];
    for (const item of batch) items.push(normalizePicked(item));
    const next = String(data.nextPageToken || data.next_page_token || "");
    if (!next || seen.has(next)) break;
    seen.add(next);
    pageToken = next;
  }
  return items;
}

export async function downloadPickedPhoto(
  fetchImpl: FetchLike,
  token: string,
  baseUrl: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; mime: string }> {
  let lastSize = 0;
  for (const size of SIZES) {
    const res = await fetchImpl(`${baseUrl}=${size}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new HttpError(502, `Photo download failed (${res.status}).`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    lastSize = bytes.byteLength;
    const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim() || "image/jpeg";
    if (bytes.byteLength > 0 && bytes.byteLength <= maxBytes) {
      return { bytes, mime: mime.startsWith("image/") ? mime : "image/jpeg" };
    }
  }
  throw new HttpError(413, `A photo was too large to store (${lastSize} bytes).`);
}
