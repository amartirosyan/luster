import { defineEventHandler, readBody, setHeader, setResponseStatus } from "h3";
import { HttpError } from "../../../google-picker.ts";
import { claimPhonePair } from "../../../pair-store.ts";

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
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 502;
    setResponseStatus(event, status);
    return {
      error: status === 502 ? "Could not reach Google Photos." : err instanceof Error ? err.message : "Could not reach Google Photos.",
    };
  }
});
