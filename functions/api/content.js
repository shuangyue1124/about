import { handleContent } from "../../worker.js";

export function onRequest(context) {
  return handleContent(context.request, context.env);
}
