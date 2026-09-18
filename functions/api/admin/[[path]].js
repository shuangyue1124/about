import { handleAdmin } from "../../../worker.js";

// Cloudflare Pages resolves routes by file path and never executes the
// `export default { fetch }` router inside worker.js. Every admin endpoint that
// lacks its own file here would answer 404 in production, so this catch-all is
// the single entry point for everything handleAdmin() serves. Pages still gives
// concrete files (login.js, comments/[id].js, ...) priority over this wildcard.
export function onRequest(context) {
  return handleAdmin(context.request, context.env, context);
}
