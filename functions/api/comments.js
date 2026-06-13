import { handleComments } from "../../worker.js";

export function onRequest(context) {
  return handleComments(context.request, context.env);
}
