// Site profile 回归：hostname 解析、联系过滤、旅行模式、语言。
// 运行：node scripts/check-site-profiles.mjs
import {
  defaultProfileFor,
  filterContacts,
  filterTravelCities,
  normalizeHostname,
  resolveAutoLanguage,
  sanitizeProfile,
} from "../assets/js/site-profile.js";
import { handleAdmin, handleContent, handleSite, handleVcard } from "../worker.js";

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
  console.log(`${cond ? "ok" : "FAIL"} - ${msg}`);
}

const ALL_CONTACTS = [
  { type: "wechat", label: "微信", value: "wx-id", url: "", enabled: true, sortOrder: 10 },
  { type: "qq", label: "QQ", value: "123", url: "", enabled: true, sortOrder: 20 },
  { type: "telegram", label: "Telegram", value: "@x", url: "https://t.me/x", enabled: true, sortOrder: 30 },
  { type: "email", label: "Email", value: "a@b.c", url: "mailto:a@b.c", enabled: true, sortOrder: 40 },
  { type: "github", label: "GitHub", value: "u", url: "https://github.com/u", enabled: true, sortOrder: 50 },
  { type: "steam", label: "Steam", value: "s", url: "https://steam/x", enabled: true, sortOrder: 60 },
];

// 1. Hostname 规范化
assert(normalizeHostname("WX.ShuangYue.Space.") === "wx.shuangyue.space", "hostname normalized (lowercase + trailing dot)");
assert(normalizeHostname(" About.Shuangyue.Space ") === "about.shuangyue.space", "hostname trimmed");

// 2. 各域名默认模板
const about = defaultProfileFor("about.shuangyue.space");
assert(about.template === "full" && about.modules.includes("comments"), "about.shuangyue.space uses full template");
const wx = defaultProfileFor("wx.shuangyue.space");
assert(wx.template === "contact" && wx.modules.join(",") === "profile,contacts", "wx.shuangyue.space uses contact template");
const qq = defaultProfileFor("qq.shuangyue.space");
assert(qq.contacts.join(",") === "qq", "qq.shuangyue.space allows only qq");
const gh = defaultProfileFor("github.shuangyue.space");
assert(gh.template === "projects" && gh.modules.includes("github"), "github.shuangyue.space uses projects template");
const travel = defaultProfileFor("travel.shuangyue.space");
assert(travel.template === "travel" && travel.travel.mode === "all", "travel.shuangyue.space opens all travel");

// 3. 未知 hostname 安全 fallback
const unknown = defaultProfileFor("evil.example.com");
assert(unknown.hostname === "evil.example.com" && unknown.template === "full", "unknown hostname gets safe fallback");

// 4. 联系过滤：wx 仅 wechat/qq
const wxContacts = filterContacts(ALL_CONTACTS, wx.contacts);
assert(wxContacts.length === 2 && wxContacts.every((c) => ["wechat", "qq"].includes(c.type)), "wx profile returns only wechat/qq");
assert(!wxContacts.some((c) => ["telegram", "email", "steam"].includes(c.type)), "wx profile excludes telegram/email/steam");
const wxValues = JSON.stringify(wxContacts);
assert(!wxValues.includes("@x") && !wxValues.includes("a@b.c"), "hidden contact values absent from wx payload");

// 5. 旅行模式
const slugs = ["beijing", "luoyang", "japan-2026", "tianjin"];
assert(filterTravelCities(slugs, { mode: "disabled", cities: [] }).length === 0, "travel disabled hides all");
assert(filterTravelCities(slugs, { mode: "all", cities: [] }).length === 4, "travel all shows all");
assert(filterTravelCities(slugs, { mode: "include", cities: ["beijing", "luoyang", "japan-2026"] }).join(",") === "beijing,luoyang,japan-2026", "travel include shows only selected");
assert(filterTravelCities(slugs, { mode: "exclude", cities: ["luoyang"] }).join(",") === "beijing,japan-2026,tianjin", "travel exclude hides blocked");

// 6. 自动语言：浏览器权重 5，时区 3，CF 国家 3；平手浏览器优先
assert(resolveAutoLanguage({ browserLang: "zh-CN", timezone: "Asia/Shanghai", cfCountry: "CN" }) === "zh", "zh browser+tz+geo -> zh");
assert(resolveAutoLanguage({ browserLang: "ja-JP", timezone: "Asia/Tokyo", cfCountry: "JP" }) === "ja", "ja signals -> ja");
assert(resolveAutoLanguage({ browserLang: "en-US", timezone: "America/New_York", cfCountry: "US" }) === "en", "en signals -> en");
assert(resolveAutoLanguage({ browserLang: "zh-CN", timezone: "America/New_York", cfCountry: "US" }) === "zh", "browser language wins tie (zh vs en)");
assert(resolveAutoLanguage({ browserLang: "en", timezone: "Asia/Tokyo", cfCountry: "JP" }) === "ja", "tz+geo (6) can outweigh single browser vote (5)");

// 7. sanitize 不信任任意 Host 输入
const evil = sanitizeProfile({ hostname: "EVIL.Example.COM.", template: "contact", language: "zh", modules: ["profile", "contacts", "hacker"], contacts: ["qq", "telegram", "evil"], travel: { mode: "include", cities: ["Beijing", "  "] } }, "about.shuangyue.space");
assert(evil.hostname === "evil.example.com", "sanitize normalizes hostname");
assert(!evil.modules.includes("hacker") && evil.modules.includes("profile"), "sanitize drops unknown modules");
assert(evil.contacts.join(",") === "qq,telegram", "sanitize drops unknown contact types");

// 8. /api/site 按 hostname 隔离（空 env 走内置默认，无 D1/KV）
const mockEnv = {};
async function siteFor(host) {
  const res = await handleSite(new Request(`https://${host}/api/site`), mockEnv);
  return res.json();
}
const wxSite = await siteFor("wx.shuangyue.space");
assert(wxSite.hostname === "wx.shuangyue.space", "/api/site echoes current hostname (wx)");
assert(Array.isArray(wxSite.contacts) && wxSite.contacts.length === 2, "/api/site wx returns 2 contacts");
assert(!JSON.stringify(wxSite.contacts).includes("t.me") && !JSON.stringify(wxSite).includes("ADMIN_PASSWORD"), "/api/site wx leaks no telegram/secrets");
assert(wxSite.profile.travel.mode === "disabled", "/api/site wx travel disabled");
const aboutSite = await siteFor("about.shuangyue.space");
assert(aboutSite.profile.modules.includes("comments") && aboutSite.profile.modules.includes("travel"), "/api/site about keeps full modules");
assert(aboutSite.hostname !== wxSite.hostname || JSON.stringify(aboutSite.contacts) !== JSON.stringify(wxSite.contacts), "different hostnames get different payloads (no cross-profile leak)");

// 9. 语言 auto 默认 + 固定语言透传
assert(about.language === "auto", "default profile language is auto");
// 综合规则补充组合：zh 浏览器在 JP（5 vs 3+3）应切 ja；en 浏览器在 CN（5 vs 3）保持 en
assert(resolveAutoLanguage({ browserLang: "zh-CN", timezone: "Asia/Tokyo", cfCountry: "JP" }) === "ja", "zh browser + JP signals -> ja");
assert(resolveAutoLanguage({ browserLang: "en-US", timezone: "Asia/Shanghai", cfCountry: "CN" }) === "zh", "en browser + CN tz/geo -> zh (local 3+3 outweighs browser 5)");

// 10. Profile 隔离：qq / github / travel
const qqSite = await siteFor("qq.shuangyue.space");
assert(Array.isArray(qqSite.contacts) && qqSite.contacts.length === 1 && qqSite.contacts[0].type === "qq", "qq.shuangyue.space returns only qq");
const ghSite = await siteFor("github.shuangyue.space");
assert(ghSite.profile.template === "projects" && ghSite.profile.modules.join(",") === "profile,github", "github.shuangyue.space uses projects template");
assert(ghSite.contacts.length === 1 && ghSite.contacts[0].type === "github", "github.shuangyue.space returns only github contact");
const travelSite = await siteFor("travel.shuangyue.space");
assert(travelSite.profile.template === "travel" && travelSite.profile.travel.mode === "all", "travel.shuangyue.space opens all travel");
assert(Array.isArray(travelSite.contacts) && travelSite.contacts.length === 0, "travel.shuangyue.space returns no contacts");

// 11. Contact 隔离：wx JSON 本身不含隐藏值
const wxJson = JSON.stringify(wxSite);
assert(!wxJson.includes("163.com") && !wxJson.includes("steamcommunity") && !wxJson.includes("CN_YangYang") && !wxJson.includes("847045298"), "wx /api/site has no email/steam/minecraft/genshin values");

// 12. vCard 按 hostname 动态过滤（/contact.vcf 与 /api/contact.vcf 同行为）
async function vcardFor(host, path) {
  const res = await handleVcard(new Request(`https://${host}${path}`), {});
  const text = await res.text();
  return { status: res.status, ct: res.headers.get("content-type"), cd: res.headers.get("content-disposition"), text };
}
const wxVcard = await vcardFor("wx.shuangyue.space", "/contact.vcf");
assert(wxVcard.status === 200 && wxVcard.ct.includes("text/vcard") && wxVcard.cd.includes("shuofeng-shuanyue.vcf"), "wx/contact.vcf headers ok");
assert(wxVcard.text.includes("BEGIN:VCARD") && wxVcard.text.includes("END:VCARD"), "wx vCard envelope ok");
assert(!wxVcard.text.includes("EMAIL") && !wxVcard.text.includes("Telegram") && !wxVcard.text.includes("Steam"), "wx vCard has no Email/Telegram/Steam");
const wxVcardApi = await vcardFor("wx.shuangyue.space", "/api/contact.vcf");
assert(wxVcardApi.text === wxVcard.text, "/api/contact.vcf matches /contact.vcf for wx");
const qqVcard = await vcardFor("qq.shuangyue.space", "/contact.vcf");
assert(qqVcard.text.includes("TYPE=qq") && !qqVcard.text.includes("TYPE=wechat") && !qqVcard.text.includes("EMAIL"), "qq vCard has only QQ");
const aboutVcard = await vcardFor("about.shuangyue.space", "/contact.vcf");
assert(aboutVcard.text.includes("TYPE=qq") && aboutVcard.text.length > wxVcard.text.length, "about vCard returns full contacts");

// 13. Content 隔离 + 缓存隔离（共享 env：wx 缓存后 qq 仍正确，无交叉）
class IsoKv {
  constructor() { this.map = new Map(); }
  async get(k, t) { const v = this.map.get(k); if (v === undefined) return null; return t === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.map.set(k, String(v)); }
  async delete(k) { this.map.delete(k); }
}
function profileD1(seeds) {
  return {
    prepare(sql) {
      return {
        _sql: sql, _v: [],
        bind(...v) { this._v = v; return this; },
        async run() { return { meta: { changes: 1 } }; },
        async first() {
          if (this._sql.includes("FROM site_profiles")) {
            const p = seeds[this._v[0]];
            return p ? { profile_json: JSON.stringify(p) } : null;
          }
          return null;
        },
        async all() { return { results: [] }; },
      };
    },
  };
}
// Fresh hostnames (never queried above, so neither memory nor KV is warm):
// proves per-hostname caching end to end, including that a cached A never
// serves B.
const isoEnv = {
  COMMENTS_KV: new IsoKv(),
  COMMENTS_DB: profileD1({
    "cache-a.shuangyue.space": { ...defaultProfileFor("cache-a.shuangyue.space"), contacts: ["qq"] },
    "cache-b.shuangyue.space": { ...defaultProfileFor("cache-b.shuangyue.space"), contacts: ["github"] },
  }),
};
const isoA = await (await handleSite(new Request("https://cache-a.shuangyue.space/api/site"), isoEnv)).json();
const isoB = await (await handleSite(new Request("https://cache-b.shuangyue.space/api/site"), isoEnv)).json();
const isoA2 = await (await handleSite(new Request("https://cache-a.shuangyue.space/api/site"), isoEnv)).json();
assert(isoA.hostname === "cache-a.shuangyue.space" && isoB.hostname === "cache-b.shuangyue.space", "cached hostnames stay separate");
assert(JSON.stringify(isoA.contacts) !== JSON.stringify(isoB.contacts), "cached contacts do not cross-pollute");
assert(JSON.stringify(isoA2.contacts) === JSON.stringify(isoA.contacts), "repeat read hits per-host cache with same payload");
const kvKeys = [...isoEnv.COMMENTS_KV.map.keys()];
assert(kvKeys.some((k) => k.includes("cache-a.shuangyue.space")) && kvKeys.some((k) => k.includes("cache-b.shuangyue.space")), "profile KV keys embed hostname");
assert(!kvKeys.some((k) => k === "site" || k === "content:github" || k === "content:anime"), "no global site/content cache keys");

// 14. Content 行级隔离（含详情 slug + travel 空结果）
function contentD1(rows) {
  const table = rows.map((r) => ({ ...r }));
  return {
    table,
    prepare(sql) {
      const self = this;
      return {
        _sql: sql, _v: [],
        bind(...v) { this._v = v; return this; },
        async run() {
          if (this._sql.includes("INSERT INTO content_items")) {
            const [id, type, slug, title, subtitle, summary, cover, url, metadata_json, enabled, sort_order, created_at, updated_at] = this._v;
            const at = table.find((r) => r.id === id);
            if (this._sql.includes("ON CONFLICT(id) DO UPDATE")) {
              // saveContentItem upsert (manual create + restore path).
              if (at) Object.assign(at, { type, slug, title, subtitle, summary, cover, url, metadata_json, enabled, sort_order, updated_at });
              else table.push({ id, type, slug, title, subtitle, summary, cover, url, metadata_json, enabled, sort_order, created_at, updated_at });
              return { meta: { changes: 1 } };
            }
            if (!at) table.push({ id, type, slug, title, subtitle, summary, cover, url, metadata_json, enabled, sort_order, created_at, updated_at });
            return { meta: { changes: 1 } };
          }
          if (this._sql.startsWith("UPDATE content_items SET url = ?")) {
            const [url, metadata_json, updated_at, id] = this._v;
            const row = table.find((r) => r.id === id);
            if (row) { row.url = url; row.metadata_json = metadata_json; row.updated_at = updated_at; }
            return { meta: { changes: 1 } };
          }
          if (this._sql.startsWith("UPDATE content_items SET enabled = 0")) {
            const [updated_at, id] = this._v;
            const row = table.find((r) => r.id === id);
            if (row) { row.enabled = 0; row.updated_at = updated_at; }
            return { meta: { changes: 1 } };
          }
          if (this._sql.startsWith("DELETE FROM content_items")) {
            const idx = table.findIndex((r) => r.id === this._v[0]);
            if (idx >= 0) table.splice(idx, 1);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (this._sql.includes("FROM content_items WHERE id = ?")) return table.find((r) => r.id === this._v[0]) || null;
          return null;
        },
        async all() {
          if (this._sql.includes("FROM content_items WHERE type = ?")) {
            let out = table.filter((r) => r.type === this._v[0]);
            if (this._sql.includes("enabled = 1")) out = out.filter((r) => Number(r.enabled) !== 0);
            return { results: out };
          }
          if (this._sql.includes("FROM content_items")) {
            let out = [...table];
            if (this._sql.includes("enabled = 1")) out = out.filter((r) => Number(r.enabled) !== 0);
            return { results: out };
          }
          return { results: [] };
        },
      };
    },
  };
}
const ghRow = {
  id: "github:demo", type: "github", slug: "demo",
  title: JSON.stringify({ zh: "演示", ja: "デモ", en: "Demo" }),
  subtitle: JSON.stringify({ zh: "", ja: "", en: "" }),
  summary: JSON.stringify({ zh: "摘要", ja: "概要", en: "Summary" }),
  cover: "", url: "https://github.com/shuangyue1124/demo",
  metadata_json: JSON.stringify({ sourceType: "github", sourceId: "shuangyue1124/demo" }),
  enabled: 1, sort_order: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};
const cEnv = { COMMENTS_DB: contentD1([ghRow]) };
const wxGh = await (await handleContent(new Request("https://wx.shuangyue.space/api/content?type=github"), cEnv)).json();
assert(Array.isArray(wxGh.items) && wxGh.items.length === 0, "wx + github content -> []");
const ghGh = await (await handleContent(new Request("https://github.shuangyue.space/api/content?type=github"), cEnv)).json();
assert(ghGh.items.length === 1 && ghGh.items[0].slug === "demo", "github domain + github returns items");
const wxDetail = await handleContent(new Request("https://wx.shuangyue.space/api/content?type=github&slug=demo"), cEnv);
assert(wxDetail.status === 404, "wx github detail slug -> 404");
const ghDetail = await (await handleContent(new Request("https://github.shuangyue.space/api/content?type=github&slug=demo"), cEnv)).json();
assert(ghDetail.item?.slug === "demo", "github domain detail returns item");
const wxTravel = await (await handleContent(new Request("https://wx.shuangyue.space/api/content?type=travel"), cEnv)).json();
assert(Array.isArray(wxTravel.items) && wxTravel.items.length === 0, "wx travel content -> [] (no leak)");

// 15. GitHub 重复导入去重 + 刷新不覆盖手工字段
const gEnv = { COMMENTS_KV: new IsoKv(), COMMENTS_DB: contentD1([]), ADMIN_PASSWORD: "pw-for-test" };
async function adminReq(path, { method = "GET", body, cookie = "" } = {}) {
  return new Request(`https://about.shuangyue.space${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(method !== "GET" ? { "x-admin-action": "1" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const loginRes = await handleAdmin(await adminReq("/api/admin/login", { method: "POST", body: { password: "pw-for-test" } }), gEnv);
const token = (loginRes.headers.get("set-cookie") || "").match(/sfsy_admin=([^;]+)/)?.[1] || "";
assert(loginRes.status === 200 && token, "admin login works for github/soft-delete tests");
const ck = `sfsy_admin=${token}`;
const repo = { name: "Demo", full_name: "shuangyue1124/demo", description: "d", html_url: "https://github.com/shuangyue1124/demo", homepage: "", language: "JavaScript", topics: ["web"], stargazers_count: 5, forks_count: 1, updated_at: "2026-01-01T00:00:00Z", archived: false };
const imp1 = await (await handleAdmin(await adminReq("/api/admin/github/import", { method: "POST", body: { repos: [repo] }, cookie: ck }), gEnv)).json();
assert(imp1.results?.[0]?.ok && imp1.results[0].deduped !== true, "first github import creates row");
// 管理员手工改标题/排序后再次导入：去重且不覆盖
await handleAdmin(await adminReq(`/api/admin/content/${encodeURIComponent("github:demo")}`, { method: "PUT", body: { item: { id: "github:demo", type: "github", slug: "demo", title: { zh: "手工标题", ja: "手動", en: "Manual" }, summary: { zh: "手工短评", ja: "手動", en: "Manual" }, url: "https://github.com/shuangyue1124/demo", cover: "manual-cover", sortOrder: 99, enabled: true } }, cookie: ck }), gEnv);
const repo2 = { ...repo, description: "d2", stargazers_count: 42 };
const imp2 = await (await handleAdmin(await adminReq("/api/admin/github/import", { method: "POST", body: { repos: [repo2] }, cookie: ck }), gEnv)).json();
assert(imp2.results?.[0]?.deduped === true, "second import deduped, no second row");
const afterDup = gEnv.COMMENTS_DB.table.filter((r) => r.id === "github:demo");
assert(afterDup.length === 1, "no duplicate content row after rescan");
assert(JSON.parse(afterDup[0].title).zh === "手工标题" && afterDup[0].cover === "manual-cover" && Number(afterDup[0].sort_order) === 99, "refresh preserves manual title/cover/sort");
assert(JSON.parse(afterDup[0].metadata_json).stars === 42, "refresh syncs upstream stars");

// 16. Content 软删除：隐藏 -> 前台消失 -> 恢复 -> 永久删除
const newItem = await (await handleAdmin(await adminReq("/api/admin/content", { method: "POST", body: { item: { type: "github", slug: "soft-me", title: { zh: "软删除", ja: " soft", en: "soft" }, summary: { zh: "s", ja: "s", en: "s" }, url: "https://example.com", enabled: true } }, cookie: ck }), gEnv)).json();
const softId = newItem.item?.id || "github:soft-me";
assert(softId, "manual content created for soft-delete test");
const vis1 = await (await handleContent(new Request("https://github.shuangyue.space/api/content?type=github"), gEnv)).json();
assert(vis1.items.some((i) => i.id === softId), "item visible before hide");
await handleAdmin(await adminReq(`/api/admin/content/${encodeURIComponent(softId)}`, { method: "DELETE", cookie: ck }), gEnv);
const hid = await (await handleContent(new Request("https://github.shuangyue.space/api/content?type=github"), gEnv)).json();
assert(!hid.items.some((i) => i.id === softId), "hidden item disappears from public API");
const adminList = await (await handleAdmin(await adminReq("/api/admin/content?type=all", { cookie: ck }), gEnv)).json();
const softRow = (adminList.items || []).find((i) => i.id === softId);
assert(softRow && softRow.enabled === false, "soft-deleted row retained in admin with enabled=false");
await handleAdmin(await adminReq(`/api/admin/content/${encodeURIComponent(softId)}`, { method: "PUT", body: { item: { ...softRow, enabled: true } }, cookie: ck }), gEnv);
const vis2 = await (await handleContent(new Request("https://github.shuangyue.space/api/content?type=github"), gEnv)).json();
assert(vis2.items.some((i) => i.id === softId), "restored item visible again");
await handleAdmin(await adminReq(`/api/admin/content/${encodeURIComponent(softId)}?permanent=1`, { method: "DELETE", cookie: ck }), gEnv);
const adminList2 = await (await handleAdmin(await adminReq("/api/admin/content?type=all", { cookie: ck }), gEnv)).json();
assert(!(adminList2.items || []).some((i) => i.id === softId), "permanently deleted row gone from admin");

if (failures.length) {
  console.error(`\ncheck-site-profiles failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`\nAll site-profile checks passed (${new Date().toISOString()}).`);
