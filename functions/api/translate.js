import { handleTranslate } from "../../worker.js";

export function onRequest(context) {
  return handleTranslate(context.request, context.env, context);
}
