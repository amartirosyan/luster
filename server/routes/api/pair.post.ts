import { defineEventHandler, setHeader } from "h3";
import { newPair } from "../../pair-store";

export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  return { id: newPair() };
});
