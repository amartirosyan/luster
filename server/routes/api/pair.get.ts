import { defineEventHandler, getQuery, setHeader } from "h3";
import { newPair, readPhonePair } from "../../pair-store.ts";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  const query = getQuery(event);
  if (String(query.new || "") === "1") return { id: await newPair() };
  return readPhonePair(String(query.id || ""));
});
