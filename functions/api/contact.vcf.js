import { handleVcard } from "../../worker.js";

export function onRequest(context) {
  return handleVcard(context.request, context.env);
}
