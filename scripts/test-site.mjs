// Second-stage closure tests: vCard, content/profile isolation, hostname-keyed
// cache, GitHub dedup, soft delete, travel guard, AI-review failure safety.
// Runs fully offline with an in-memory FakeD1 exercising the real handlers.
// Run: node scripts/test-site.mjs
import { handleAdmin, handleContent, handleSite, handleVcard, githubSourceId } from "../worker.js";

const failures = [];
let count = 0;
function assert(cond, msg) {
  count += 1;
  if (!cond) failures.push(msg);
  console.log(`${cond ? "ok" : "FAIL"} - ${msg}`);
}

// ---------- Minimal in-memory D1 ----------
function createFakeD1() {
  const tables = { site_config: [], site_profiles: [], content_items: [], contact_items: [] };
  return {
    tables,
    prepare(sql) {
      const q = String(sql);
      const api = {
        _params: [],
        bind(...p) { api._params = p; return api; },
        async first() {
          if (q.includes("FROM site_config")) {
            return tables.site_config.find((r) => r.key === api._params[0]) || null;
          }
          if (q.includes("FROM site_profiles")) {
            const r = tables.site_profiles.find((r) => r.hostname === api._params[0]);
            return r ? { profile_json: r.profile_json } : null;
          }
          if (q.includes("FROM content_items")) {
            if (q.includes("source_type")) {
              return tables.content_items.find((r) => r.source_type === api._params[0] && r.source_id === api._params[1]) || null;
            }
            return tables.content_items.find((r) => r.id === api._params[0]) || null;
          }
          return null;
        },
        async all() {
          if (q.includes("FROM content_items")) {
            let rows = [...tables.content_items];
            if (q.includes("WHERE type = ?")) rows = rows.filter((r) => r.type === api._params[0]);
            if (q.includes("enabled = 1")) rows = rows.filter((r) => Number(r.enabled) !== 0);
            rows.sort((a, b) => (a.sort_order - b.sort_order));
            return { results: rows };
          }
          if (q.includes("FROM site_profiles")) {
            return { results: tables.site_profiles.map((r) => ({ hostname: r.hostname, profile_json: r.profile_json })) };
          }
          if (q.includes("FROM contact_items")) return { results: [] };
          return { results: [] };
        },
        async run() {
          const p = api._params;
          if (/^\s*(CREATE|ALTER)\b/i.test(q)) return { meta: {} };
          if (q.includes("INTO site_profiles")) {
            const [, hostname, enabled, profile_json, updated_at] = p;
            const ix = tables.site_profiles.findIndex((r) => r.hostname === hostname);
            const row = { id: hostname, hostname, enabled, profile_json, updated_at };
            if (ix >= 0) tables.site_profiles[ix] = row; else tables.site_profiles.push(row);
            return { meta: {} };
          }
          if (q.includes("INTO content_items")) {
            const cols = ["id", "type", "slug", "title", "subtitle", "summary", "cover", "url", "metadata_json", "enabled", "sort_order", "source_type", "source_id", "created_at", "updated_at"];
            const obj = Object.fromEntries(cols.map((c, i) => [c, p[i]]));
            const ix = tables.content_items.findIndex((r) => r.id === obj.id);
            if (ix >= 0) tables.content_items[ix] = { ...tables.content_items[ix], ...obj };
            else tables.content_items.push(obj);
            return { meta: {} };
          }
          if (q.includes("UPDATE content_items SET enabled")) {
            const r = tables.content_items.find((r) => r.id === p[2]);
            if (r) { r.enabled = p[0]; r.updated_at = p[1]; }
            return { meta: {} };
          }
          if (q.includes("DELETE FROM content_items")) {
            tables.content_items = tables.content_items.filter((r) => r.id !== p[0]);
            return { meta: {} };
          }
          if (q.includes("DELETE FROM site_profiles")) {
            tables.site_profiles = tables.site_profiles.filter((r) => r.hostname !== p[0]);
            return { meta: {} };
          }
          return { meta: {} };
        },
      };
      return api;
    },
  };
}

const env = { COMMENTS_DB: createFakeD1(), ADMIN_PASSWORD: "test-admin-pw" };
const get = (host, path) => new Request(`https://${host}${path}`, { headers: { accept: "application/json" } });

// ---------- Admin login (real auth path) ----------
const loginRes = await handleAdmin(new Request("https://about.shuangyue.space/api/admin/login", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "test-admin-pw" }),
}), env);
assert(loginRes.status === 200, "admin login works with ADMIN_PASSWORD");
const cookie = String(loginRes.headers.get("set-cookie") || "").split(";")[0];
assert(cookie.startsWith("sfsy_admin="), "login sets admin cookie");
const admin = (path, method = "GET", body) => new Request(`https://about.shuangyue.space${path}`, {
  method,
  headers: { "content-type": "application/json", accept: "application/json", cookie, "x-admin-action": "1" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const asJson = async (res) => res.json().catch(() => ({}));

// ---------- 1. Dynamic vCard ----------
async function vcard(host, path = "/contact.vcf") {
  const res = await handleVcard(new Request(`https://${host}${path}`), env);
  return { res, text: await res.text() };
}
let v = await vcard("wx.shuangyue.space");
assert(v.res.status === 200, "wx /contact.vcf returns 200");
assert(String(v.res.headers.get("content-type") || "").startsWith("text/vcard"), "vCard content-type is text/vcard");
assert(String(v.res.headers.get("content-disposition") || "").includes("shuofeng-shuanyue.vcf"), "vCard has inline filename disposition");
assert(v.text.includes("BEGIN:VCARD") && v.text.includes("END:VCARD") && v.text.includes("FN:"), "vCard has VCARD envelope");
assert(v.text.includes("1970259391"), "wx vCard contains QQ");
assert(!v.text.includes("hzq101116@163.com") && !v.text.includes("t.me") && !v.text.includes("steamcommunity"), "wx vCard leaks no Email/Telegram/Steam");
v = await vcard("qq.shuangyue.space");
assert(v.text.includes("1970259391") && !v.text.includes("TYPE=wechat"), "qq vCard contains only QQ");
v = await vcard("about.shuangyue.space");
assert(v.text.includes("EMAIL") && v.text.includes("t.me") && v.text.includes("1970259391"), "about vCard contains full public contacts");
v = await vcard("wx.shuangyue.space", "/api/contact.vcf");
assert(v.res.status === 200 && v.text.includes("1970259391") && !v.text.includes("t.me"), "/api/contact.vcf mirrors hostname filtering");
v = await vcard("evil.example.com");
assert(v.res.status === 200 && v.text.includes("BEGIN:VCARD"), "unknown hostname vCard falls back safely");

// ---------- 2. Seed content via real admin endpoints ----------
const repoA = { name: "about", description: "first desc", html_url: "https://github.com/shuangyue1124/about", homepage: "", language: "JavaScript", topics: ["web"], stargazers_count: 5, forks_count: 1, updated_at: "2026-01-01T00:00:00Z", archived: false };
const repoB = { name: "dotfiles", description: "dots", html_url: "https://github.com/shuangyue1124/dotfiles", homepage: "", language: "Shell", topics: [], stargazers_count: 2, forks_count: 0, updated_at: "2026-02-01T00:00:00Z", archived: false };
let r = await handleAdmin(admin("/api/admin/github/import", "POST", { repos: [repoA, repoB] }), env);
let j = await asJson(r);
assert(r.status === 200 && j.imported.length === 2 && j.deduped === 0, "github import adds 2 projects");
r = await handleAdmin(admin("/api/admin/content", "POST", { item: {
  type: "anime", slug: "bocchi-the-rock",
  title: { zh: "孤独摇滚", ja: "ぼっち・ざ・ろっく", en: "Bocchi the Rock" },
  summary: { zh: "阴角吉他少女的乐队故事。", ja: "陰キャギター少女のバンド物語。", en: "An introvert guitarist joins a band." },
  enabled: true,
} }), env);
assert(r.status === 201, "manual anime project can be added (source_type=manual)");

// ---------- 3. Content isolation by hostname/module ----------
async function content(host, qs) {
  const res = await handleContent(get(host, `/api/content${qs}`), env);
  return { res, json: await asJson(res) };
}
let c = await content("wx.shuangyue.space", "?type=github");
assert(c.res.status === 200 && Array.isArray(c.json.items) && c.json.items.length === 0, "wx + github list returns [] (module closed)");
const ghSlug = j.imported[0].slug;
c = await content("wx.shuangyue.space", `?type=github&slug=${ghSlug}`);
assert(c.res.status === 404, "wx + github detail returns 404 (server re-checks module)");
c = await content("github.shuangyue.space", "?type=github");
assert(c.json.items.length === 2, "github domain + github returns projects");
c = await content("github.shuangyue.space", `?type=github&slug=${ghSlug}`);
assert(c.res.status === 200 && c.json.item.slug === ghSlug, "github domain detail loads");
c = await content("about.shuangyue.space", "?type=all");
assert(c.json.items.length === 3, "about type=all sees anime + github");
assert(!("enabled" in c.json.items[0]) && !("sourceId" in c.json.items[0]) && !("sourceType" in c.json.items[0]), "public items expose no admin-only fields");
c = await content("about.shuangyue.space", "?type=travel");
assert(Array.isArray(c.json.items) && c.json.items.length === 0, "travel has no dynamic list (static data.js stays canonical)");

// ---------- 4. Cache isolation (sequential, shared process memory) ----------
await content("wx.shuangyue.space", "?type=github"); // populate wx cache
c = await content("qq.shuangyue.space", "?type=github");
assert(c.json.items.length === 0, "qq cache does not serve wx payload");
c = await content("github.shuangyue.space", "?type=github");
assert(c.json.items.length === 2, "github cache does not serve wx empty payload");
const s1 = await (await handleSite(get("wx.shuangyue.space", "/api/site"), env)).json();
const s2 = await (await handleSite(get("qq.shuangyue.space", "/api/site"), env)).json();
assert(s1.contacts.length === 2 && s2.contacts.length === 1, "wx/qq site caches stay isolated");

// ---------- 5. GitHub dedup: re-import updates instead of duplicating ----------
assert(githubSourceId({ html_url: "https://github.com/ShuangYue1124/About/" }) === "shuangyue1124/about", "githubSourceId normalizes owner/repo");
r = await handleAdmin(admin("/api/admin/github/import", "POST", { repos: [{ ...repoA, description: "second desc", stargazers_count: 42 }] }), env);
j = await asJson(r);
assert(j.deduped === 1, "second import reports deduped instead of duplicating");
c = await content("github.shuangyue.space", "?type=github");
assert(c.json.items.length === 2, "no duplicate row after re-import");
const aboutItem = c.json.items.find((i) => i.slug === ghSlug);
assert(aboutItem.metadata.stars === 42, "re-import syncs upstream stars");
// Admin-edited title/cover/sort survive re-import
const itemId = j.imported[0].id;
await handleAdmin(admin(`/api/admin/content/${itemId}`, "PUT", { item: { ...j.imported[0], title: { zh: "我的站", ja: "私のサイト", en: "My Site" }, cover: "cover.png", sortOrder: 99 } }), env);
r = await handleAdmin(admin("/api/admin/github/import", "POST", { repos: [{ ...repoA, description: "third desc", stargazers_count: 43 }] }), env);
c = await content("github.shuangyue.space", "?type=github");
const renamed = c.json.items.find((i) => i.slug === ghSlug);
assert(renamed.title.zh === "我的站" && renamed.cover === "cover.png" && renamed.sortOrder === 99, "admin title/cover/sort survive re-import");
assert(renamed.metadata.stars === 43, "stats still refresh on re-import");
// manualReview pins the summary
await handleAdmin(admin(`/api/admin/content/${itemId}`, "PUT", { item: { ...renamed, enabled: true, metadata: { ...renamed.metadata, manualReview: true } } }), env);
await handleAdmin(admin("/api/admin/github/import", "POST", { repos: [{ ...repoA, description: "fourth desc" }] }), env);
c = await content("github.shuangyue.space", "?type=github");
assert(c.json.items.find((i) => i.slug === ghSlug).summary.zh === renamed.summary.zh, "manualReview summary is not overwritten");

// ---------- 6. Soft delete lifecycle ----------
r = await handleAdmin(admin(`/api/admin/content/${itemId}`, "DELETE"), env);
j = await asJson(r);
assert(r.status === 200 && j.soft === true, "DELETE defaults to soft delete (hide)");
c = await content("github.shuangyue.space", "?type=github");
assert(c.json.items.length === 1, "hidden item disappears from public list");
r = await handleAdmin(admin("/api/admin/content?type=github&all=1"), env);
j = await asJson(r);
assert(j.items.length === 2 && j.items.some((i) => i.id === itemId && i.enabled === false), "admin still sees hidden item and can restore");
await handleAdmin(admin(`/api/admin/content/${itemId}`, "PUT", { item: { ...j.items.find((i) => i.id === itemId), enabled: true } }), env);
c = await content("github.shuangyue.space", "?type=github");
assert(c.json.items.length === 2, "restore makes item public again");
r = await handleAdmin(admin(`/api/admin/content/${itemId}?permanent=1`, "DELETE"), env);
j = await asJson(r);
assert(j.permanent === true, "permanent delete is explicit");
r = await handleAdmin(admin("/api/admin/content?type=github&all=1"), env);
j = await asJson(r);
assert(j.items.length === 1, "permanently deleted item is gone everywhere");

// ---------- 7. AI review without binding fails safe ----------
const remainingId = j.items[0].id;
const beforeSummary = j.items[0].summary;
r = await handleAdmin(admin("/api/admin/ai-review", "POST", { id: remainingId }), env);
assert(r.status !== 200, "AI review without Workers AI binding does not succeed silently");
r = await handleAdmin(admin("/api/admin/content?type=github&all=1"), env);
j = await asJson(r);
assert(JSON.stringify(j.items.find((i) => i.id === remainingId).summary) === JSON.stringify(beforeSummary), "failed AI review leaves saved content untouched");

// ---------- 8. Hostname normalization through the real handler ----------
const upper = await (await handleSite(new Request("https://WX.Shuangyue.Space./api/site"), {})).json();
assert(upper.hostname === "wx.shuangyue.space" && upper.contacts.length === 2, "WX.Shuangyue.Space. normalizes to wx profile");

if (failures.length) {
  console.error(`\ntest-site failed (${count} checks):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`\nAll test-site checks passed (${count} checks).`);
