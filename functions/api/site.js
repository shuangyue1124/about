import { handleSite } from "../../worker.js";

export function onRequest(context) {
  return handleSite(context.request, context.env);
}
