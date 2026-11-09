import { defineEventHandler, readBody, setHeader, setResponseStatus } from "h3";
import { HttpError } from "../../google-picker.ts";
import { newPair } from "../../pair-store.ts";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  const payload = (await readBody(event).catch(() => ({}))) as { purpose?: string; tvId?: string };
  try {
    return { id: await newPair({ purpose: payload?.purpose, tvId: payload?.tvId }) };
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    setResponseStatus(event, status);
    return { error: err instanceof Error ? err.message : "Could not make a code." };
  }
});
