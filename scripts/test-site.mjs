import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { buildTelegramMessage, handleAdmin, handleComments, handleCspReport, handleEvents, handleSite, handleTranslate, sendTelegramNotification } from "../worker.js";
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
    // Optional fixtures keyed by a SQL substring, so handlers can be driven
    // through branches that need a row back (an existing parent comment, a
    // cached translation, a stale-language list).
    this.fixtures = new Map();
  }
  prepare(sql) {
    const db = this;
    db.lastSql = sql;
    const match = [...db.fixtures.entries()].find(([key]) => sql.includes(key));
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
        return match ? match[1].first ?? null : null;
      },
      async all() {
        return { results: match ? match[1].all ?? [] : [] };
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
  const bigBody = JSON.stringify({ name: "smoke", message: "y".repeat(9000) });
  const big = await asJson(await handleComments(apiRequest("/api/comments", { method: "POST", body: bigBody, headers: { "content-length": String(bigBody.length) } }), env));
  check("comments 超大 body → 413", big.status === 413, big.status);
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

  // telegram helpers: failure must never throw, secrets must never leak
  const sampleText = buildTelegramMessage(
    { id: "comment-1", name: "Example User", message: "Hello!", status: "approved", ip: "203.0.113.9", createdAt: "2026-09-05T13:42:18.000Z" },
    { page: "/en/", lang: "en" }
  );
  check("telegram 文案不含原始 IP", !sampleText.includes("203.0.113.9"), sampleText.slice(0, 60));
  check("telegram 文案含 ID/状态/时间", sampleText.includes("comment-1") && sampleText.includes("approved") && sampleText.includes("+08:00"));
  const tgSkipped = await sendTelegramNotification(env, "hi");
  check("telegram 未配置 → skipped 不抛错", tgSkipped.skipped === true && tgSkipped.ok === false);
  const tgEnv = { ...env, TELEGRAM_BOT_TOKEN: "fake-token", TELEGRAM_CHAT_ID: "123" };
  const tgFailed = await sendTelegramNotification(tgEnv, "hi", async () => { throw new Error("network down"); });
  check("telegram 网络失败 → ok:false 不抛错", tgFailed.ok === false && !tgFailed.skipped);
  const tgSent = await sendTelegramNotification(tgEnv, "hi", async () => new Response("{}", { status: 200 }));
  check("telegram 发送成功 → ok:true", tgSent.ok === true);

  // admin-only telegram test endpoint: anonymous blocked, unconfigured → 503 without leaking secrets
  const tgAnon = await asJson(await handleAdmin(apiRequest("/api/admin/test-telegram", { method: "POST", body: {} }), env));
  check("test-telegram 未登录 → 401", tgAnon.status === 401, tgAnon.status);
  const tgAdmin = await asJson(await handleAdmin(apiRequest("/api/admin/test-telegram", {
    method: "POST",
    body: {},
    headers: { "x-admin-action": "1" },
    cookie: `sfsy_admin=${token}`,
  }), env));
  const tgBody = JSON.stringify(tgAdmin.data || {});
  check("test-telegram 未配置 → 503 且不泄露 secret", tgAdmin.status === 503 && !/fake|token|chat/i.test(tgBody), tgAdmin.status);

  // ---- comment replies ----
  // Fresh KV (the rate-limit quota above is already spent for this IP) plus a
  // stubbed Turnstile endpoint so the request can reach the persistence path.
  const replyEnv = { ...env, COMMENTS_DB: new MemoryDb(), COMMENTS_KV: new MemoryKv(), TURNSTILE_SECRET_KEY: "test-secret" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => (
    String(input?.url || input).includes("challenges.cloudflare.com")
      ? new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } })
      : realFetch(input, init)
  );

  const orphanReply = await asJson(await handleComments(apiRequest("/api/comments", {
    method: "POST",
    body: { name: "smoke", message: "hello", parentId: "missing-parent", turnstileToken: "x" },
  }), replyEnv));
  check("回复不存在的评论 → 400", orphanReply.status === 400, orphanReply.status);

  replyEnv.COMMENTS_DB.fixtures.set("SELECT id, name, status FROM comments WHERE id", { first: { id: "parent-1", status: "pending" } });
  const pendingReply = await asJson(await handleComments(apiRequest("/api/comments", {
    method: "POST",
    body: { name: "smoke", message: "hello", parentId: "parent-1", turnstileToken: "x" },
  }), replyEnv));
  check("回复未公开评论 → 400", pendingReply.status === 400, pendingReply.status);

  replyEnv.COMMENTS_DB.fixtures.set("SELECT id, name, status FROM comments WHERE id", { first: { id: "parent-1", status: "approved", name: "Parent Nick" } });
  const okReply = await asJson(await handleComments(apiRequest("/api/comments", {
    method: "POST",
    body: { name: "smoke", message: "hello", parentId: "parent-1", turnstileToken: "x" },
  }), replyEnv));
  // No AI binding here, so the reply lands in pending; the parent link is what
  // matters — it has to survive the moderation + persistence pipeline, and the
  // Telegram notification must be able to name the parent.
  check("回复已公开评论 → 202 且保留 parentId", okReply.status === 202 && okReply.data?.comment?.parentId === "parent-1", `${okReply.status}/${okReply.data?.comment?.parentId}`);
  check("回复携带父评论昵称（Telegram 用）", okReply.data?.comment?.parentName === "Parent Nick", okReply.data?.comment?.parentName);
  globalThis.fetch = realFetch;

  // ---- AI translation ----
  const trEnv = { ...env, COMMENTS_DB: new MemoryDb() };
  const trGet = await asJson(await handleTranslate(apiRequest("/api/translate"), trEnv));
  check("GET /api/translate → 405", trGet.status === 405, trGet.status);
  const trLang = await asJson(await handleTranslate(apiRequest("/api/translate", {
    method: "POST",
    body: { lang: "zh", items: [{ id: "a", text: "首页" }] },
  }), trEnv));
  check("translate 静态语言 zh → 400", trLang.status === 400, trLang.status);
  const trEmpty = await asJson(await handleTranslate(apiRequest("/api/translate", {
    method: "POST",
    body: { lang: "ko", items: [] },
  }), trEnv));
  check("translate 空 items → 400", trEmpty.status === 400, trEmpty.status);
  const trNoAi = await asJson(await handleTranslate(apiRequest("/api/translate", {
    method: "POST",
    body: { lang: "ko", items: [{ id: "a", text: "首页" }] },
  }), trEnv));
  check("translate 无 AI 绑定 → 503", trNoAi.status === 503, trNoAi.status);

  // Model returns a JSON array of the same length: every entry must be stored
  // and returned, otherwise the page would render half-translated.
  const aiCalls = [];
  const trAiEnv = {
    ...env,
    COMMENTS_DB: new MemoryDb(),
    AI: {
      run: async (model, input) => {
        aiCalls.push(model);
        const texts = JSON.parse(String(input.messages[0].content).split("Input:\n")[1]);
        return { response: JSON.stringify(texts.map((text) => `KO:${text}`)) };
      },
    },
  };
  const trOk = await asJson(await handleTranslate(apiRequest("/api/translate", {
    method: "POST",
    body: { lang: "ko", items: [{ id: "ui:home", text: "首页" }, { id: "comment:1", text: "这是一条留言" }] },
  }), trAiEnv));
  check(
    "translate 成功 → 200 且每个 id 都有译文",
    trOk.status === 200 && trOk.data?.translations?.["ui:home"] === "KO:首页" && trOk.data?.translations?.["comment:1"] === "KO:这是一条留言",
    JSON.stringify(trOk.data?.translations || {})
  );
  check("translate 首次全部为新译文", trOk.data?.freshCount === 2 && trOk.data?.cachedCount === 0, `${trOk.data?.freshCount}/${trOk.data?.cachedCount}`);
  check("translate 使用可配置模型", typeof trOk.data?.model === "string" && trOk.data.model.length > 0);

  // A model answer that is not a valid array of the right length must fail as a
  // whole (502) instead of producing partial copy; already-finished batches stay
  // cached so a retry only pays for the rest.
  const badAiEnv = { ...trAiEnv, COMMENTS_DB: new MemoryDb(), AI: { run: async () => ({ response: "抱歉，我无法翻译" }) } };
  const trBad = await asJson(await handleTranslate(apiRequest("/api/translate", {
    method: "POST",
    body: { lang: "ko", items: [{ id: "ui:home", text: "首页" }] },
  }), badAiEnv));
  check("translate 模型返回非法结果 → 502", trBad.status === 502, trBad.status);

  // The model has a hard output ceiling (~150 chars per item, measured against
  // all 12 AI languages), and copy past it used to fail the whole request — one
  // long comment took the entire page back to the source language. Long copy
  // must now be split into model-sized pieces and rejoined, short items in the
  // same request must survive, and nothing may be truncated.
  const longSeen = [];
  const longAiEnv = {
    ...env,
    COMMENTS_DB: new MemoryDb(),
    AI: {
      run: async (model, input) => {
        const texts = JSON.parse(String(input.messages[0].content).split("Input:\n")[1]);
        longSeen.push(...texts);
        return { response: JSON.stringify(texts.map((t) => `KO:${t}`)) };
      },
    },
  };
  // Three sentences so the splitter has real boundaries to cut on.
  const longComment = "这是一条很长的留言内容。".repeat(30);
  const trLong = await asJson(await handleTranslate(apiRequest("/api/translate", {
    method: "POST",
    body: { lang: "ko", items: [{ id: "comment:long", text: longComment }] },
  }), longAiEnv));
  const longOut = trLong.data?.translations?.["comment:long"] || "";
  check(
    "translate 超长文本 → 分段翻译而非整页失败",
    trLong.status === 200 && longSeen.length > 1 && longSeen.every((t) => t.length <= 150),
    `${trLong.status}/${longSeen.length} 段`
  );
  // The mock prefixes every chunk with "KO:", so remove one prefix per chunk
  // before comparing: what matters is that the source survives the split and
  // rejoin whole, in order, with nothing dropped at a chunk boundary.
  const stripChunkPrefixes = (value, count) => {
    let out = value;
    for (let i = 0; i < count; i += 1) out = out.replace("KO:", "");
    return out;
  };
  const longPlain = stripChunkPrefixes(longOut, longSeen.length);
  check(
    "translate 超长文本 → 内容完整无截断",
    longPlain.replace(/\s+/g, "") === longComment.replace(/\s+/g, ""),
    `${longOut.length}/${longComment.length} (${longSeen.length} 段)`
  );
  check("translate 超长文本 → 不标记为 skipped", !(trLong.data?.skipped || []).includes("comment:long"), JSON.stringify(trLong.data?.skipped));

  // A long item must not cost the short ones their translation.
  const trMixed = await asJson(await handleTranslate(apiRequest("/api/translate", {
    method: "POST",
    body: {
      lang: "ko",
      items: [
        { id: "ui:home", text: "首页" },
        { id: "comment:mixed", text: longComment },
      ],
    },
  }), longAiEnv));
  check(
    "translate 长短混合 → 短文案与长留言都成功",
    trMixed.status === 200 && trMixed.data?.translations?.["ui:home"] === "KO:首页" && Boolean(trMixed.data?.translations?.["comment:mixed"]),
    `${trMixed.status}`
  );

  // Absurdly long copy (no punctuation at all) still has to come back whole:
  // the splitter's hard-cut fallback must not drop or duplicate characters.
  const hugeNoPunct = "長".repeat(2001);
  const trOver = await asJson(await handleTranslate(apiRequest("/api/translate", {
    method: "POST",
    body: { lang: "ko", items: [{ id: "ui:over", text: hugeNoPunct }] },
  }), longAiEnv));
  const overSegments = Math.ceil(hugeNoPunct.length / 150);
  const overPlain = stripChunkPrefixes(trOver.data?.translations?.["ui:over"] || "", overSegments);
  check(
    "translate 2001 字无标点长串 → 分段后完整无丢失",
    trOver.status === 200 && overPlain === hugeNoPunct,
    `${trOver.status}/${overPlain.length}`,
  );

  // ---- translation cache admin endpoints ----
  const statsAnon = await asJson(await handleAdmin(apiRequest("/api/admin/translate-stats"), env));
  check("translate-stats 未登录 → 401", statsAnon.status === 401, statsAnon.status);
  const statsOk = await asJson(await handleAdmin(apiRequest("/api/admin/translate-stats", { cookie: `sfsy_admin=${token}` }), env));
  check("translate-stats 管理员 → 200 + 语言清单", statsOk.status === 200 && Array.isArray(statsOk.data?.languages), statsOk.status);

  const cleanupEnv = { ...env, COMMENTS_DB: new MemoryDb() };
  cleanupEnv.COMMENTS_DB.fixtures.set("SELECT lang FROM translation_lang_usage", { all: [{ lang: "ko" }] });
  const purgeAnon = await asJson(await handleAdmin(apiRequest("/api/admin/translate-cleanup", {
    method: "POST",
    body: { lang: "ko" },
    headers: { "x-admin-action": "1" },
  }), cleanupEnv));
  check("translate-cleanup 未登录 → 401", purgeAnon.status === 401, purgeAnon.status);
  const purgeOk = await asJson(await handleAdmin(apiRequest("/api/admin/translate-cleanup", {
    method: "POST",
    body: { lang: "ko" },
    headers: { "x-admin-action": "1" },
    cookie: `sfsy_admin=${token}`,
  }), cleanupEnv));
  check("translate-cleanup 管理员 → 200 + 删除计数", purgeOk.status === 200 && purgeOk.data?.deletedLangs === 1, JSON.stringify(purgeOk.data || {}));
  const purgeBad = await asJson(await handleAdmin(apiRequest("/api/admin/translate-cleanup", {
    method: "POST",
    body: { lang: "zh" },
    headers: { "x-admin-action": "1" },
    cookie: `sfsy_admin=${token}`,
  }), cleanupEnv));
  check("translate-cleanup 静态语言 → 400", purgeBad.status === 400, purgeBad.status);

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
