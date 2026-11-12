import { defineEventHandler, setHeader } from "h3";
import { newPair } from "../../pair-store";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  return { id: await newPair() };
});
