import { handleCspReport } from "../../worker.js";

export function onRequest(context) {
  return handleCspReport(context.request);
}
