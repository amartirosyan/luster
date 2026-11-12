import { randomBytes } from "node:crypto";

type PairStatus = "waiting" | "scanned" | "picking" | "done" | "error";

type Pair = {
  created: number;
  status: PairStatus;
  token: string;
  expiresAt: number;
  sessionId: string;
  pickerUri: string;
  error: string;
};

const phonePairs = new Map<string, Pair>();
const PAIR_TTL = 70 * 60 * 1000;

function pairFresh(pair: Pair) {
  if (Date.now() - pair.created > PAIR_TTL) return false;
  if (pair.expiresAt && pair.expiresAt < Date.now()) return false;
  return true;
}

export function newPair() {
  const now = Date.now();
  for (const [id, pair] of phonePairs) {
    if (!pairFresh(pair)) phonePairs.delete(id);
  }
  const id = randomBytes(16).toString("hex");
  phonePairs.set(id, {
    created: now,
    status: "waiting",
    token: "",
    expiresAt: 0,
    sessionId: "",
    pickerUri: "",
    error: "",
  });
  return id;
}

export function markPhonePairOpened(id: string) {
  const pair = phonePairs.get(id);
  if (!pair || !pairFresh(pair)) {
    return { error: "This code expired. Scan the television again." };
  }
  if (pair.status === "waiting") pair.status = "scanned";
  return { ok: true, status: pair.status };
}

export async function claimPhonePair(id: string, token: string, expiresIn: number) {
  const pair = phonePairs.get(id);
  if (!pair || !pairFresh(pair)) return { error: "This code expired. Scan the television again." };
  if (pair.pickerUri) return { pickerUri: pair.pickerUri };
  const upstream = await fetch("https://photospicker.googleapis.com/v1/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: "{}",
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    pair.status = "error";
    pair.error = "Google did not start the photo picker.";
    return { error: pair.error };
  }
  let created: { id?: string; pickerUri?: string } = {};
  try {
    created = JSON.parse(text);
  } catch {
    pair.status = "error";
    pair.error = "Google sent an unreadable reply.";
    return { error: pair.error };
  }
  const uri = String(created.pickerUri || "");
  let host = "";
  try {
    host = new URL(uri).hostname;
  } catch {
    host = "";
  }
  if (!uri.startsWith("https://") || (host !== "photos.google.com" && !host.endsWith(".google.com"))) {
    pair.status = "error";
    pair.error = "Google sent an unexpected picker link.";
    return { error: pair.error };
  }
  pair.token = token;
  pair.expiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000;
  pair.sessionId = String(created.id || "").replace(/^sessions\//, "");
  pair.pickerUri = uri;
  pair.status = pair.sessionId ? "picking" : "error";
  if (!pair.sessionId) pair.error = "Google did not return a selection id.";
  return pair.sessionId ? { pickerUri: uri } : { error: pair.error };
}

export async function readPhonePair(id: string) {
  const pair = phonePairs.get(id);
  if (!pair || Date.now() - pair.created > PAIR_TTL) {
    return { status: "error", error: "This code expired. Make a new code on the television." };
  }
  if (pair.expiresAt && pair.expiresAt < Date.now()) {
    return { status: "error", error: "This screensaver link expired." };
  }
  if (pair.status === "picking" && pair.token && pair.sessionId) {
    try {
      const upstream = await fetch(
        `https://photospicker.googleapis.com/v1/sessions/${encodeURIComponent(pair.sessionId)}`,
        { headers: { Authorization: `Bearer ${pair.token}`, Accept: "application/json" } },
      );
      const json = (await upstream.json().catch(() => ({}))) as {
        mediaItemsSet?: boolean | string;
        media_items_set?: boolean | string;
      };
      const flag = json.mediaItemsSet ?? json.media_items_set;
      if (flag === true || flag === "true") pair.status = "done";
    } catch {
      /* the television will ask again */
    }
  }
  const body: { status: string; error?: string; sessionId?: string; token?: string; expiresIn?: number } = {
    status: pair.status,
  };
  if (pair.error) body.error = pair.error;
  if (pair.status === "done") {
    body.sessionId = pair.sessionId;
    body.token = pair.token;
    body.expiresIn = Math.max(1, Math.round((pair.expiresAt - Date.now()) / 1000));
  }
  return body;
}
