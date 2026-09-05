import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { handleAdmin, handleComments, handleCspReport, handleEvents, handleSite } from "../worker.js";
import { checkHtmlLinks } from "./check-links.mjs";

const ROOT = resolve(".");
const PUBLIC_DIR = resolve(ROOT, "public");

// ---------------------------------------------------------------------------
// Static site smoke test: serve public/ and check every sitemap URL.
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".vcf": "text/vcard; charset=utf-8",
  ".ico": "image/x-icon",
};

function startServer() {
  return new Promise((done) => {
    const server = createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const candidates = [resolve(PUBLIC_DIR, relative)];
      if (relative.endsWith("/")) candidates.push(resolve(PUBLIC_DIR, relative, "index.html"));
      if (!extname(relative)) candidates.push(resolve(PUBLIC_DIR, `${relative}.html`), resolve(PUBLIC_DIR, relative, "index.html"));

      const file = candidates.find((candidate) => {
        try {
          return statSync(candidate).isFile();
        } catch {
          return false;
        }
      });
      if (!file) {
        response.writeHead(404).end("not found");
        return;
      }
      response.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      response.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => done(server));
  });
}

function sitemapUrls() {
  const sitemap = readFileSync(resolve(PUBLIC_DIR, "sitemap.xml"), "utf8");
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

async function staticSmoke(base) {
  const failures = [];
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures.push(name);
  };

  const urls = sitemapUrls();
  for (const url of urls) {
    const path = new URL(url).pathname;
    const response = await fetch(`${base}${path}`);
    check(`${path} → 200`, response.status === 200, `got ${response.status}`);
    if (response.status !== 200) continue;
    const html = await response.text();
    check(`${path} title`, /<title>[^<]+<\/title>/.test(html));
    check(`${path} html lang`, /<html[^>]*lang="(zh-CN|ja-JP|en-US)"/.test(html));
    check(`${path} h1`, /<h1[\s>]/.test(html));
    check(`${path} main#main-content`, /<main[^>]*id="main-content"/.test(html));
    const canonical = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1] || "";
    check(`${path} canonical matches sitemap`, canonical === url, canonical);

    const { errors } = checkHtmlLinks(html, resolve(PUBLIC_DIR, path === "/" ? "index.html" : path.slice(1)));
    if (errors.length) check(`${path} 本地图片/资源引用`, false, errors.slice(0, 2).join("; "));
    else check(`${path} 本地图片/资源引用`, true);
  }

  return failures;
}

// ---------------------------------------------------------------------------
// API smoke test: exercise worker.js handlers with in-memory KV/D1 mocks.
// ---------------------------------------------------------------------------

class MemoryKv {
  constructor() {
    this.map = new Map();
  }
  async get(key, type) {
    const value = this.map.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value) {
    this.map.set(key, String(value));
  }
  async delete(key) {
    this.map.delete(key);
  }
}

class MemoryDb {
  constructor() {
    this.writes = 0;
    this.lastSql = "";
    this.lastValues = [];
  }
  prepare(sql) {
    const db = this;
    db.lastSql = sql;
    return {
      bind(...values) {
        this.values = values;
        db.lastValues = values;
        return this;
      },
      async run() {
        db.writes += 1;
        return { meta: { changes: 1 } };
      },
      async first() {
        return null;
      },
      async all() {
        return { results: [] };
      },
    };
  }
}

function apiRequest(path, { method = "GET", body, headers = {}, cookie = "" } = {}) {
  const h = { "user-agent": "smoke-test/1.0", "content-type": "application/json", ...headers };
  if (cookie) h.cookie = cookie;
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`https://about.shuangyue.space${path}`, init);
}

async function apiSmoke() {
  const failures = [];
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (got ${detail})` : ""}`);
    if (!ok) failures.push(name);
  };
  const asJson = async (response) => ({
    status: response.status,
    data: await response.json().catch(() => null),
    headers: Object.fromEntries(response.headers),
  });

  const env = {
    COMMENTS_KV: new MemoryKv(),
    COMMENTS_DB: new MemoryDb(),
    ADMIN_PASSWORD: "smoke-password",
  };

  // /api/site
  const site = await asJson(await handleSite(apiRequest("/api/site"), env));
  check("GET /api/site → 200 + settings", site.status === 200 && typeof site.data?.settings === "object");
  check("public API 保留 CORS *", site.headers["access-control-allow-origin"] === "*");
  check("public API 安全头 nosniff", site.headers["x-content-type-options"] === "nosniff");
  const sitePost = await asJson(await handleSite(apiRequest("/api/site", { method: "POST" }), env));
  check("POST /api/site → 405", sitePost.status === 405, sitePost.status);

  // /api/events validation + rate limit
  const noUa = await asJson(await handleEvents(apiRequest("/api/events", { method: "POST", body: {}, headers: { "user-agent": "" } }), env));
  check("events 空 UA → 400", noUa.status === 400, noUa.status);
  const badType = await asJson(await handleEvents(apiRequest("/api/events", { method: "POST", body: { type: "hack", path: "/" } }), env));
  check("events 非法 type → 400", badType.status === 400, badType.status);
  const good = await asJson(await handleEvents(apiRequest("/api/events", { method: "POST", body: { type: "page_view", path: "/", page: "home", lang: "zh" } }), env));
  check("events 合法 page_view → 202", good.status === 202, good.status);
  let flood = null;
  for (let i = 0; i < 70; i += 1) {
    flood = await asJson(await handleEvents(apiRequest("/api/events", { method: "POST", body: { type: "page_view", path: "/" } }), env));
  }
  check("events 连续 POST → 429 + Retry-After", flood.status === 429 && typeof flood.headers["retry-after"] === "string", flood.status);

  // /api/comments validation + rate limit
  const empty = await asJson(await handleComments(apiRequest("/api/comments", { method: "POST", body: {} }), env));
  check("comments 空 body → 400", empty.status === 400, empty.status);
  let commentsLimited = null;
  for (let i = 0; i < 6; i += 1) {
    commentsLimited = await asJson(await handleComments(apiRequest("/api/comments", {
      method: "POST",
      body: { name: "smoke", message: "hello", turnstileToken: "x" },
    }), env));
  }
  check("comments 第 6 次 POST → 429", commentsLimited.status === 429, commentsLimited.status);

  // /api/admin auth + login rate limit
  const anon = await asJson(await handleAdmin(apiRequest("/api/admin/me"), env));
  check("admin 未登录 → 401", anon.status === 401, anon.status);
  check("admin API 无跨域头", anon.headers["access-control-allow-origin"] === undefined);
  for (let i = 0; i < 5; i += 1) {
    await asJson(await handleAdmin(apiRequest("/api/admin/login", { method: "POST", body: { password: "wrong" } }), env));
  }
  const locked = await asJson(await handleAdmin(apiRequest("/api/admin/login", { method: "POST", body: { password: "wrong" } }), env));
  check("login 6 次失败 → 429", locked.status === 429, locked.status);

  // Simulate a fresh 5-minute window: drop the login-failure counters only.
  for (const key of [...env.COMMENTS_KV.map.keys()]) {
    if (key.includes("login-fail")) env.COMMENTS_KV.map.delete(key);
  }

  const success = await asJson(await handleAdmin(apiRequest("/api/admin/login", { method: "POST", body: { password: "smoke-password" } }), env));
  check("login 正确密码 → 200 + HttpOnly/Secure/SameSite=Lax", success.status === 200 && /HttpOnly/.test(success.headers["set-cookie"] || "") && /Secure/.test(success.headers["set-cookie"] || "") && /SameSite=Lax/.test(success.headers["set-cookie"] || ""), success.status);
  const token = success.headers["set-cookie"]?.match(/sfsy_admin=([^;]+)/)?.[1] || "";
  const me = await asJson(await handleAdmin(apiRequest("/api/admin/me", { cookie: `sfsy_admin=${token}` }), env));
  check("admin /me 带 cookie → 200", me.status === 200, me.status);

  // cleanup-events auth
  const cleanupAnon = await asJson(await handleAdmin(apiRequest("/api/admin/cleanup-events", { method: "POST", body: {} }), env));
  check("cleanup 未登录 → 401", cleanupAnon.status === 401, cleanupAnon.status);
  const cleanup = await asJson(await handleAdmin(apiRequest("/api/admin/cleanup-events", {
    method: "POST",
    body: { days: 90 },
    headers: { "x-admin-action": "1" },
    cookie: `sfsy_admin=${token}`,
  }), env));
  check("cleanup 管理员 → 200 + deleted", cleanup.status === 200 && typeof cleanup.data?.deleted === "number", cleanup.status);

  // ai-chat session rate limit
  let chatLimited = null;
  for (let i = 0; i < 31; i += 1) {
    chatLimited = await asJson(await handleAdmin(apiRequest("/api/admin/ai-chat", {
      method: "POST",
      body: { message: "hi" },
      headers: { "x-admin-action": "1" },
      cookie: `sfsy_admin=${token}`,
    }), env));
  }
  check("ai-chat 第 31 次 → 429", chatLimited.status === 429, chatLimited.status);

  // csp-report endpoint
  const report = await handleCspReport(apiRequest("/api/csp-report", { method: "POST", body: '{"csp-report":{"blocked-uri":"x"}}' }));
  check("csp-report → 204", report.status === 204, report.status);

  return failures;
}

// ---------------------------------------------------------------------------

const staticFailures = await staticSmoke(await (async () => {
  const server = await startServer();
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
})());
const apiFailures = await apiSmoke();

const total = staticFailures.length + apiFailures.length;
console.log(`\n${total === 0 ? "ALL SITE TESTS PASSED" : `${total} SITE TEST(S) FAILED`}`);
process.exit(total === 0 ? 0 : 1);
