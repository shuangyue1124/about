// Forwarding shim kept for the admin.html script URL. admin.js itself is
// served with Cache-Control: no-cache (see _headers), so no version query is
// needed here — a stale hardcoded ?v= here once survived a global version bump
// because check-links only scans HTML.
import "./admin.js";
