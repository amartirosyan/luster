import { createHash, randomBytes } from "node:crypto";

const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function hashSecret(value: string): string {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function newPublicId(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

export function newJoinCode(): string {
  const buf = randomBytes(8);
  let out = "";
  for (let i = 0; i < buf.length; i += 1) out += JOIN_ALPHABET[buf[i] % JOIN_ALPHABET.length];
  return out;
}

export function cleanTvId(value: unknown): string {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return "";
  return id;
}

export function cleanAlbumName(value: unknown): string {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name) return "";
  return name.slice(0, 80);
}

export function cleanJoinCode(value: unknown): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 8);
}
