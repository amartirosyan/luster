import { defineEventHandler, readBody, setHeader, setResponseStatus } from "h3";
import { markPhonePairOpened } from "../../../pair-store";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  const payload = (await readBody(event).catch(() => ({}))) as { id?: string };
  const id = String(payload?.id || "");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing code." };
  }
  const result = await markPhonePairOpened(id);
  if (result.error) setResponseStatus(event, 404);
  return result;
});
