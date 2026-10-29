import { handleVcard } from "../worker.js";

// Keep the public download URL dynamic in production. Pages would otherwise
// serve the static public/contact.vcf, which cannot vary by hostname or IP rule.
export function onRequest(context) {
  return handleVcard(context.request, context.env);
}
