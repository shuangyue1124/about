import { handleEvents } from "../../worker.js";

export function onRequest(context) {
  return handleEvents(context.request, context.env);
}
