import { handleAdmin } from "../../../worker.js";

export function onRequest(context) {
  return handleAdmin(context.request, context.env);
}
