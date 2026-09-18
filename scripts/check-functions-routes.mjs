// Guard test for Cloudflare Pages file-based routing.
//
// Pages ignores `export default { fetch }` inside worker.js: only files under
// functions/ become reachable routes. Every "/api/..." path literal in worker.js
// must therefore resolve to a functions/ file, or that endpoint answers 404 in
// production while working fine under `wrangler dev`. This resolves routes with
// the same specificity rules Pages uses, so it fails the moment someone adds a
// handler without adding (or covering) its route file.
//
// Run: node scripts/check-functions-routes.mjs
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(".");
const FUNCTIONS_DIR = resolve(ROOT, "functions");
const WORKER_FILE = resolve(ROOT, "worker.js");

// Sample values used to turn route prefixes (/api/admin/profiles/) into a
// concrete request path the router can be asked to resolve.
const SAMPLE_SEGMENT = "sample-id";

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (full.endsWith(".js")) files.push(full);
  }
  return files;
}

// "/api/admin/comments/[id]" -> [{ type: "literal" | "param" | "catchall", value }]
function parseRouteSpec(routePath) {
  return routePath.split("/").filter(Boolean).map((segment) => {
    if (segment.startsWith("[[") && segment.endsWith("]]")) return { type: "catchall", value: segment.slice(2, -2) };
    if (segment.startsWith("[") && segment.endsWith("]")) return { type: "param", value: segment.slice(1, -1) };
    return { type: "literal", value: segment };
  });
}

// Returns the number of path segments consumed, or -1 when the route does not match.
function matchSpec(spec, segments, index = 0) {
  if (index >= spec.length) return segments.length === index ? index : -1;
  const part = spec[index];
  if (part.type === "catchall") return segments.length;
  if (index >= segments.length) return -1;
  if (part.type === "literal" && decodeSafe(part.value) !== segments[index]) return -1;
  return matchSpec(spec, segments, index + 1);
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Pages prefers the most specific route: deeper literal prefixes first, and a
// single-segment [param] over a trailing [[catchall]].
function specificity(entry, segments) {
  const literals = entry.spec.filter((part) => part.type === "literal").length;
  const tail = entry.spec[entry.spec.length - 1];
  const tailRank = !tail || tail.type === "literal" ? 2 : tail.type === "param" ? 1 : 0;
  return [literals, tailRank, entry.route.length];
}

function betterThan(a, b, segments) {
  const ka = specificity(a, segments);
  const kb = specificity(b, segments);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return ka[i] > kb[i];
  }
  return a.route.localeCompare(b.route) < 0;
}

// A functions/ file is only real wiring when it imports a handler that worker.js
// actually exports; a typo there would still route, then crash at runtime.
function handlerSymbol(file) {
  const source = readFileSync(file, "utf8");
  const match = source.match(/import\s+\{\s*([A-Za-z0-9_$]+)\s*\}\s+from\s+"([^"]+)"/);
  if (!match) return null;
  const [, symbol, specifier] = match;
  if (!specifier.startsWith(".")) return { symbol, target: null, ok: false, reason: "import is not a local module" };
  const target = resolve(dirname(file), specifier);
  if (!existsSync(target)) return { symbol, target, ok: false, reason: "imported module is missing" };
  const exported = new RegExp(`export\\s+(?:async\\s+)?function\\s+${symbol}\\b`).test(readFileSync(target, "utf8"));
  return { symbol, target, ok: exported, reason: exported ? "" : `${symbol} is not exported by the imported module` };
}

function collectExpectedRoutes(workerSource) {
  // Only startsWith() comparisons describe prefixes; every other "/api/..." literal
  // is an exact endpoint (worker.js usually accepts both forms, with and without a
  // trailing slash, and Pages normalizes the trailing slash away).
  const prefixes = new Set();
  const prefixPattern = /startsWith\("(\/api\/[^"]*)"\)/g;
  let prefixMatch;
  while ((prefixMatch = prefixPattern.exec(workerSource))) prefixes.add(prefixMatch[1]);

  const routes = new Set();
  const literalPattern = /"(\/api\/[^"]*)"/g;
  let match;
  while ((match = literalPattern.exec(workerSource))) {
    const raw = match[1].replace(/\/+$/, "");
    routes.add(raw);
    // Prefix routes are reachable through their children; probe one level deeper.
    if (prefixes.has(match[1])) routes.add(`${raw}/${SAMPLE_SEGMENT}`);
  }
  return [...routes].sort();
}

const functionFiles = walk(FUNCTIONS_DIR);
const entries = functionFiles
  .map((file) => {
    // Windows returns backslashes from resolve(); Pages routes always use "/".
    const route = "/" + file.slice(FUNCTIONS_DIR.length + 1).replace(/\\/g, "/").replace(/\.js$/, "");
    return { file, route, spec: parseRouteSpec(route) };
  })
  .filter((entry) => !entry.route.endsWith("/_middleware"));

const workerSource = readFileSync(WORKER_FILE, "utf8");
const expected = collectExpectedRoutes(workerSource);

const failures = [];
const resolved = new Set();

for (const path of expected) {
  const segments = decodeSafe(path).split("/").filter(Boolean);
  const candidates = entries.filter((entry) => matchSpec(entry.spec, segments) === segments.length);
  if (!candidates.length) {
    failures.push(`${path} -> no functions/ route file resolves this path`);
    continue;
  }
  const winner = candidates.reduce((best, entry) => (betterThan(entry, best, segments) ? entry : best), candidates[0]);
  resolved.add(winner.route);
  const handler = handlerSymbol(winner.file);
  if (!handler) {
    failures.push(`${path} -> ${winner.file.slice(ROOT.length + 1)} does not import a handler from worker.js`);
  } else if (!handler.ok) {
    failures.push(`${path} -> ${handler.symbol} in ${winner.file.slice(ROOT.length + 1)} (${handler.reason})`);
  }
}

const orphans = entries.filter((entry) => !resolved.has(entry.route)).map((entry) => entry.route);

if (failures.length) {
  console.error(`check-functions-routes: ${failures.length} route(s) are not reachable in production:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("  Add a matching functions/**/*.js route file, or extend the existing catch-all.");
  process.exit(1);
}

const orphanNote = orphans.length ? `，${orphans.length} 个未见引用的路由文件: ${orphans.join(", ")}` : "";
console.log(
  `check-functions-routes: OK（${expected.length} 个 worker.js 路由全部有可达的 functions/ 入口，${entries.length} 个路由文件${orphanNote}）`
);
