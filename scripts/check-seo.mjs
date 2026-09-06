import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(".");
const PUBLIC_DIR = resolve(ROOT, "public");

function sitemapUrls() {
  const sitemap = readFileSync(resolve(PUBLIC_DIR, "sitemap.xml"), "utf8");
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function htmlFileForUrl(url) {
  const path = new URL(url).pathname;
  const direct = resolve(PUBLIC_DIR, path === "/" ? "index.html" : path.slice(1));
  if (isFile(direct)) return direct;
  if (isDir(direct)) return resolve(direct, "index.html");
  return "";
}

function tagAttr(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? match[1] : "";
}

function findTag(html, pattern) {
  return html.match(pattern)?.[0] || "";
}

function metaContent(html, attr, value) {
  const pattern = new RegExp(`<meta\\b[^>]*\\b${attr}="${value}"[^>]*>`, "i");
  return tagAttr(findTag(html, pattern), "content");
}

function metaProperty(html, property) {
  const pattern = new RegExp(`<meta\\b[^>]*\\bproperty="${property}"[^>]*>`, "i");
  return tagAttr(findTag(html, pattern), "content");
}

function metaName(html, name) {
  const pattern = new RegExp(`<meta\\b[^>]*\\bname="${name}"[^>]*>`, "i");
  return tagAttr(findTag(html, pattern), "content");
}

function htmlLang(html) {
  return tagAttr(findTag(html, /<html\b[^>]*>/i), "lang");
}

function canonical(html) {
  const pattern = /<link\b[^>]*\brel="canonical"[^>]*>/i;
  return tagAttr(findTag(html, pattern), "href");
}

const LANGS = {
  zh: "zh-CN",
  ja: "ja-JP",
  en: "en-US",
};

function langOfPath(pathname) {
  const first = pathname.split("/").filter(Boolean)[0] || "";
  return LANGS[first] ? first : "zh";
}

function check() {
  const errors = [];
  const fail = (page, message) => errors.push(`${page}: ${message}`);
  const urls = sitemapUrls();

  for (const url of urls) {
    const file = htmlFileForUrl(url);
    if (!file) {
      fail(url, "sitemap URL 没有对应 HTML 文件");
      continue;
    }
    const html = readFileSync(file, "utf8");
    const rel = file.slice(PUBLIC_DIR.length + 1);

    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] || "";
    if (!title.trim()) fail(rel, "缺少非空 <title>");

    const description = metaName(html, "description");
    if (!description.trim()) fail(rel, "缺少非空 meta description");

    const canonicalUrl = canonical(html);
    if (!canonicalUrl || canonicalUrl !== url) fail(rel, `canonical 与 sitemap 不一致（${canonicalUrl || "缺失"}）`);

    const alternates = html.match(/<link\b[^>]*\brel="alternate"[^>]*>/gi) || [];
    if (alternates.length < 4) fail(rel, `hreflang alternate 少于 4 个（当前 ${alternates.length}）`);

    for (const field of ["og:title", "og:description", "og:image"]) {
      if (!metaProperty(html, field).trim()) fail(rel, `缺少 ${field}`);
    }
    if (!metaName(html, "twitter:card").trim()) fail(rel, "缺少 twitter:card");
    if (!/<script type="application\/ld\+json">/.test(html)) fail(rel, "缺少 JSON-LD");

    const lang = htmlLang(html);
    const expected = LANGS[langOfPath(new URL(url).pathname)];
    if (lang !== expected) fail(rel, `<html lang> 期望 ${expected}，实际 ${lang || "缺失"}`);

    if (!/<h1[\s>]/.test(html)) fail(rel, "缺少 <h1>");
    if (!/<main[\s>]/.test(html)) fail(rel, "缺少 <main>");
  }

  if (errors.length) {
    console.error(`check-seo: ${errors.length} 个问题`);
    for (const error of errors.slice(0, 50)) console.error(`  ❌ ${error}`);
    if (errors.length > 50) console.error(`  ... 另有 ${errors.length - 50} 个`);
    process.exit(1);
  }
  console.log(`check-seo: OK（${urls.length} 个页面 SEO 元素完整）`);
}

if (!isFile(resolve(PUBLIC_DIR, "sitemap.xml"))) {
  console.error("check-seo: public/sitemap.xml 不存在，请先运行 npm run build");
  process.exit(1);
}
check();
