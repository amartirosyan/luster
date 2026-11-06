import { defineEventHandler, readBody, setHeader, setResponseStatus } from "h3";
import { claimPhonePair } from "../../../pair-store";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  const payload = (await readBody(event).catch(() => ({}))) as {
    id?: string;
    token?: string;
    expiresIn?: number;
  };
  const id = String(payload?.id || "");
  const token = String(payload?.token || "");
  if (!id || !token) {
    setResponseStatus(event, 400);
    return { error: "Missing sign-in." };
  }
  try {
    return await claimPhonePair(id, token, Number(payload.expiresIn) || 3600);
  } catch {
    setResponseStatus(event, 502);
    return { error: "Could not reach Google Photos." };
  }
});
