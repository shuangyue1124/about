import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const ROOT = resolve(".");
const PUBLIC_DIR = resolve(ROOT, "public");

export function walkHtmlFiles(dir = PUBLIC_DIR) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walkHtmlFiles(full));
    else if (full.endsWith(".html")) files.push(full);
  }
  return files;
}

function attrOf(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? match[1] : "";
}

// Collect href/src/srcset/poster values only from tags that carry real URLs,
// plus og:image / og:url meta content. Avoid matching viewport/description/name
// attributes that also use the "content" attribute name.
function localTargets(html) {
  const targets = [];
  const tagPatterns = [
    { re: /<a\b[^>]*>/gi, attrs: ["href"] },
    { re: /<link\b[^>]*>/gi, attrs: ["href", "imagesrcset"] },
    { re: /<img\b[^>]*>/gi, attrs: ["src", "srcset"] },
    { re: /<source\b[^>]*>/gi, attrs: ["src", "srcset"] },
    { re: /<script\b[^>]*>/gi, attrs: ["src"] },
    { re: /<video\b[^>]*>/gi, attrs: ["src", "poster"] },
    { re: /<meta\b[^>]*property="(?:og:image|og:url)"[^>]*>/gi, attrs: ["content"] },
  ];

  for (const { re, attrs } of tagPatterns) {
    let match;
    while ((match = re.exec(html))) {
      for (const attr of attrs) {
        const value = attrOf(match[0], attr);
        if (value) targets.push(value);
      }
    }
  }
  return targets;
}

function isLocal(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^(https?:|mailto:|tel:|data:|javascript:|blob:|#)/i.test(text)) return false;
  if (text.startsWith("//")) return false;
  return true;
}

function stripQueryHash(value) {
  return value.split("#")[0].split("?")[0];
}

function resolveLocalFile(fromHtmlFile, value) {
  const cleaned = stripQueryHash(value.trim());
  const base = cleaned.startsWith("/") ? PUBLIC_DIR : dirname(fromHtmlFile);
  const direct = resolve(base, cleaned.startsWith("/") ? cleaned.slice(1) : cleaned);
  const candidates = [direct];
  if (!extname(direct)) candidates.push(`${direct}.html`, resolve(direct, "index.html"));
  if (direct.endsWith("/")) candidates.push(resolve(direct, "index.html"));
  return candidates;
}

export function checkHtmlLinks(html, htmlFile) {
  const errors = [];
  let checked = 0;

  for (const value of localTargets(html)) {
    if (!isLocal(value)) continue;
    for (const srcsetEntry of value.split(",")) {
      const candidate = srcsetEntry.trim().split(/\s+/)[0];
      if (!isLocal(candidate)) continue;
      checked += 1;
      const files = resolveLocalFile(htmlFile, candidate);
      if (!files.some((file) => existsSync(file))) {
        errors.push(`${htmlFile.slice(PUBLIC_DIR.length + 1)}: 本地链接不存在 "${candidate}"`);
      }
    }
  }

  return { errors, checked };
}

export function checkAllHtmlLinks() {
  const errors = [];
  let checked = 0;
  for (const file of walkHtmlFiles()) {
    const html = readFileSync(file, "utf8");
    const result = checkHtmlLinks(html, file);
    errors.push(...result.errors);
    checked += result.checked;
  }
  return { errors, checked };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve("scripts/check-links.mjs");
if (isMain) {
  if (!existsSync(PUBLIC_DIR)) {
    console.error("check-links: public/ 不存在，请先运行 npm run build");
    process.exit(1);
  }
  const result = checkAllHtmlLinks();
  if (result.errors.length) {
    console.error(`check-links: ${result.errors.length} 个断链`);
    for (const error of result.errors.slice(0, 50)) console.error(`  ❌ ${error}`);
    if (result.errors.length > 50) console.error(`  ... 另有 ${result.errors.length - 50} 个`);
    process.exit(1);
  }
  console.log(`check-links: OK（检查 ${result.checked} 个本地引用）`);
}
