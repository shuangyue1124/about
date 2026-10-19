import { handleAvatar } from "../../worker.js";

export function onRequest(context) {
  return handleAvatar(context.request, context.env);
}
