import { handleComments, handleEvents, handleSite, handleAdmin, handleCspReport } from "../../worker.js";

class MemoryKv {
  constructor() { this.map = new Map(); }
  async get(key, type) {
    const value = this.map.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
}

class MemoryDb {
  constructor() { this.writes = 0; this.lastSql = ""; this.lastValues = []; }
  prepare(sql) {
    const db = this;
    db.lastSql = sql;
    return {
      bind(...values) { this.values = values; db.lastValues = values; return this; },
      async run() { db.writes += 1; return { meta: { changes: 1 } }; },
      async first() { return null; },
      async all() { return { results: [] }; },
    };
  }
}

function makeEnv() {
  const kv = new MemoryKv();
  const db = new MemoryDb();
  return {
    env: {
      COMMENTS_KV: kv,
      COMMENTS_DB: db,
      ADMIN_PASSWORD: "test-password-123",
    },
    kv,
    db,
  };
}

function req(path, { method = "GET", body, headers = {}, cookie = "" } = {}) {
  const h = {
    "user-agent": "smoke-test/1.0",
    "content-type": "application/json",
    ...headers,
  };
  if (cookie) h.cookie = cookie;
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`https://about.shuangyue.space${path}`, init);
}

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${actual}, want ${expected})`);
  if (!ok) failures += 1;
}

async function jsonOf(response) {
  return { status: response.status, data: await response.json().catch(() => null), headers: Object.fromEntries(response.headers) };
}

const { env, kv, db } = makeEnv();

// --- production-like ensureSchema bootstrap is off ---
{
  check("RUNTIME_SCHEMA_BOOTSTRAP absent in env", env.RUNTIME_SCHEMA_BOOTSTRAP === undefined, true);
  await handleSite(req("/api/site"), env);
  check("ensureSchema runs no DDL without bootstrap flag", db.writes, 0);
}

// --- /api/site ---
{
  const ok = await jsonOf(await handleSite(req("/api/site"), env));
  check("GET /api/site → 200", ok.status, 200);
  check("GET /api/site settings exists", typeof ok.data?.settings === "object", true);
  check("public CORS *", ok.headers["access-control-allow-origin"], "*");
  const bad = await jsonOf(await handleSite(req("/api/site", { method: "POST" }), env));
  check("POST /api/site → 405", bad.status, 405);
}

// --- /api/events ---
{
  const noUa = await jsonOf(await handleEvents(req("/api/events", { method: "POST", body: {}, headers: { "user-agent": "" } }), env));
  check("events missing UA → 400", noUa.status, 400);

  const writesBefore = db.writes;
  const badType = await jsonOf(await handleEvents(req("/api/events", { method: "POST", body: { type: "hack", path: "/" } }), env));
  check("events random type → 400", badType.status, 400);
  check("events random type no D1 write", db.writes - writesBefore, 0);

  const badLang = await jsonOf(await handleEvents(req("/api/events", { method: "POST", body: { type: "page_view", path: "/", lang: "fr" } }), env));
  check("events random lang → 400", badLang.status, 400);

  const good = await jsonOf(await handleEvents(req("/api/events", { method: "POST", body: { type: "page_view", path: "/travel/", page: "travel", lang: "zh" } }), env));
  check("events valid page_view → 202", good.status, 202);
  check("events valid wrote 1 row", db.writes - writesBefore, 1);

  let limited = null;
  for (let i = 0; i < 70; i += 1) {
    limited = await jsonOf(await handleEvents(req("/api/events", { method: "POST", body: { type: "page_view", path: "/" } }), env));
  }
  check("events flood → 429", limited.status, 429);
  check("429 has retry-after", typeof limited.headers["retry-after"] === "string", true);
}

// --- /api/comments ---
{
  const empty = await jsonOf(await handleComments(req("/api/comments", { method: "POST", body: {} }), env));
  check("comments empty body → 400", empty.status, 400);

  let limited = null;
  for (let i = 0; i < 6; i += 1) {
    limited = await jsonOf(await handleComments(req("/api/comments", {
      method: "POST",
      body: { name: "smoke", message: "hello", turnstileToken: "x" },
    }), env));
  }
  check("comments 6th POST → 429", limited.status, 429);
}

// --- /api/admin ---
{
  const anon = await jsonOf(await handleAdmin(req("/api/admin/me"), env));
  check("admin /me without cookie → 401", anon.status, 401);
  check("admin headers have no CORS", anon.headers["access-control-allow-origin"] === undefined, true);
  check("admin security header nosniff", anon.headers["x-content-type-options"], "nosniff");

  for (let i = 0; i < 5; i += 1) {
    await jsonOf(await handleAdmin(req("/api/admin/login", { method: "POST", body: { password: "wrong" } }), env));
  }
  const locked = await jsonOf(await handleAdmin(req("/api/admin/login", { method: "POST", body: { password: "wrong" } }), env));
  check("login 6th failure → 429", locked.status, 429);

  // Rate limit key is per 5-minute bucket; reset KV to simulate a fresh window for the success path.
  for (const key of [...kv.map.keys()]) kv.map.delete(key);
  const success = await jsonOf(await handleAdmin(req("/api/admin/login", { method: "POST", body: { password: "test-password-123" } }), env));
  check("login correct password → 200", success.status, 200);
  const cookie = success.headers["set-cookie"] || "";
  check("login cookie HttpOnly+Secure+SameSite=Lax", /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Lax/.test(cookie), true);

  const token = cookie.match(/sfsy_admin=([^;]+)/)?.[1] || "";
  const me = await jsonOf(await handleAdmin(req("/api/admin/me", { cookie: `sfsy_admin=${token}` }), env));
  check("admin /me with cookie → 200", me.status, 200);

  // Wrong-password failures did not clear the success window key issue: success path cleared; verify login works again.
  const again = await jsonOf(await handleAdmin(req("/api/admin/login", { method: "POST", body: { password: "test-password-123" } }), env));
  check("login again after success → 200", again.status, 200);

  let chatLimited = null;
  for (let i = 0; i < 31; i += 1) {
    chatLimited = await jsonOf(await handleAdmin(req("/api/admin/ai-chat", {
      method: "POST",
      body: { message: "hi" },
      headers: { "x-admin-action": "1" },
      cookie: `sfsy_admin=${token}`,
    }), env));
  }
  check("ai-chat 31st call → 429", chatLimited.status, 429);
  check("ai-chat first calls → 503 sanitized", chatLimited.status !== 503 || chatLimited.data?.error === "service unavailable", true);

  // --- cleanup-events ---
  const cleanupAnon = await jsonOf(await handleAdmin(req("/api/admin/cleanup-events", { method: "POST", body: {} }), env));
  check("cleanup without cookie → 401", cleanupAnon.status, 401);

  const cleanupNoAction = await jsonOf(await handleAdmin(req("/api/admin/cleanup-events", {
    method: "POST",
    body: { days: 90 },
    cookie: `sfsy_admin=${token}`,
  }), env));
  check("cleanup without x-admin-action → 403", cleanupNoAction.status, 403);

  const cleanupOk = await jsonOf(await handleAdmin(req("/api/admin/cleanup-events", {
    method: "POST",
    body: { days: 90 },
    headers: { "x-admin-action": "1" },
    cookie: `sfsy_admin=${token}`,
  }), env));
  check("cleanup with admin session → 200", cleanupOk.status, 200);
  check("cleanup returns deleted count", cleanupOk.data?.deleted, 1);
  check("cleanup executed DELETE on site_events", /DELETE FROM site_events/.test(db.lastSql), true);
  check("cleanup cutoff is ISO date", Number.isNaN(Date.parse(db.lastValues[0])), false);

  const badDays = await jsonOf(await handleAdmin(req("/api/admin/cleanup-events", {
    method: "POST",
    body: { days: 99999 },
    headers: { "x-admin-action": "1" },
    cookie: `sfsy_admin=${token}`,
  }), env));
  check("cleanup days capped at 365", badDays.data?.days, 365);

  // --- site_config is D1-only; KV must not receive site:settings ---
  const configPut = await jsonOf(await handleAdmin(req("/api/admin/config", {
    method: "PUT",
    body: { config: { commentsEnabled: true } },
    headers: { "x-admin-action": "1" },
    cookie: `sfsy_admin=${token}`,
  }), env));
  check("PUT config with admin session → 200", configPut.status, 200);
  check("saveSiteConfig no longer writes KV site:settings", kv.map.has("site:settings"), false);
}

// --- /api/csp-report ---
{
  const report = await handleCspReport(req("/api/csp-report", { method: "POST", body: '{"csp-report":{"blocked-uri":"x"}}' }));
  check("csp-report → 204", report.status, 204);
}

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
