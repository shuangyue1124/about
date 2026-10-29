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
import {
  ipMatchesCidr,
  matchIpProfileRule,
  normalizeCidr,
} from "../worker.js";
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

// 17. IP/CIDR normalization and precedence
assert(normalizeCidr("203.0.113.42/24")?.selector === "203.0.113.0/24", "IPv4 CIDR clears host bits");
assert(normalizeCidr("2001:0db8::1/32")?.selector === "2001:db8::/32", "IPv6 CIDR canonicalizes and clears host bits");
assert(normalizeCidr("203.0.113.10")?.selector === "203.0.113.10/32", "bare IPv4 becomes /32");
assert(normalizeCidr("2001:db8::1")?.selector === "2001:db8::1/128", "bare IPv6 becomes /128");
assert(normalizeCidr("999.1.1.1/24") === null && normalizeCidr("203.0.113.0/33") === null, "invalid IP/CIDR rejected");
assert(ipMatchesCidr("203.0.113.42", "203.0.113.0/24"), "IPv4 CIDR match");
assert(ipMatchesCidr("2001:db8:1::5", "2001:db8::/32"), "IPv6 CIDR match");
assert(!ipMatchesCidr("2001:db8::1", "203.0.113.0/24"), "IP families never cross-match");
const tieRules = [
  { id: "wide", selector: "203.0.113.0/24", priority: 100, prefixLen: 24, enabled: true },
  { id: "pinned", selector: "203.0.113.42/32", priority: 100, prefixLen: 32, enabled: true },
  { id: "urgent", selector: "203.0.113.0/24", priority: 10, prefixLen: 24, enabled: true },
];
assert(matchIpProfileRule(tieRules, "203.0.113.42")?.id === "urgent", "lower priority number wins before prefix length");
assert(matchIpProfileRule(tieRules.filter((rule) => rule.id !== "urgent"), "203.0.113.42")?.id === "pinned", "same priority uses longest prefix");
assert(matchIpProfileRule([{ ...tieRules[0], enabled: false }], "203.0.113.42") === null, "disabled rule never matches");

// 18. Public handlers honor CF-Connecting-IP and fall back to hostname
function ipRulesD1(profiles, rules) {
  const db = {
    profiles: { ...profiles },
    rules: rules.map((rule) => ({ ...rule })),
    prepare(sql) {
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (sql.includes("FROM site_profiles WHERE hostname = ?")) {
            return db.profiles[this.values[0]] || null;
          }
          if (sql.includes("FROM ip_profile_rules WHERE selector = ?")) {
            return db.rules.find((rule) => rule.selector === this.values[0] && rule.id !== this.values[1]) || null;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM ip_profile_rules")) return { results: db.rules.map((rule) => ({ ...rule })) };
          return { results: [] };
        },
        async run() {
          if (sql.includes("INSERT INTO ip_profile_rules")) {
            const [id, selector, family, prefix_len, target_hostname, priority, enabled, note, updated_at] = this.values;
            const existing = db.rules.find((rule) => rule.id === id);
            const next = { id, selector, family, prefix_len, target_hostname, priority, enabled, note, updated_at };
            if (existing) Object.assign(existing, next);
            else db.rules.push(next);
            return { meta: { changes: 1 } };
          }
          if (sql.includes("DELETE FROM ip_profile_rules WHERE id = ?")) {
            const before = db.rules.length;
            db.rules = db.rules.filter((rule) => rule.id !== this.values[0]);
            return { meta: { changes: before - db.rules.length } };
          }
          return { meta: { changes: 1 } };
        },
      };
    },
  };
  return db;
}

const ipProfiles = {
  "about.shuangyue.space": { profile_json: JSON.stringify(defaultProfileFor("about.shuangyue.space")) },
  "wx.shuangyue.space": { profile_json: JSON.stringify(defaultProfileFor("wx.shuangyue.space")) },
  "ip-target.shuangyue.space": {
    profile_json: JSON.stringify({ ...defaultProfileFor("ip-target.shuangyue.space"), contacts: ["email"] }),
  },
};
const ipDb = ipRulesD1(ipProfiles, [
  { id: "office-wide", selector: "203.0.113.0/24", family: "ipv4", prefix_len: 24, target_hostname: "ip-target.shuangyue.space", priority: 200, enabled: 1, note: "office", updated_at: "2026-01-01T00:00:00Z" },
  { id: "office-pinned", selector: "203.0.113.42/32", family: "ipv4", prefix_len: 32, target_hostname: "wx.shuangyue.space", priority: 50, enabled: 1, note: "pinned", updated_at: "2026-01-01T00:00:00Z" },
  { id: "office-v6", selector: "2001:db8::/48", family: "ipv6", prefix_len: 48, target_hostname: "ip-target.shuangyue.space", priority: 100, enabled: 1, note: "v6", updated_at: "2026-01-01T00:00:00Z" },
]);
const ipEnv = { COMMENTS_KV: new IsoKv(), COMMENTS_DB: ipDb, ADMIN_PASSWORD: "pw-for-test" };
async function siteWithIp(ip, extraHeaders = {}) {
  const headers = { ...(ip ? { "CF-Connecting-IP": ip } : {}), ...extraHeaders };
  return (await handleSite(new Request("https://about.shuangyue.space/api/site", { headers }), ipEnv)).json();
}
const ipPinned = await siteWithIp("203.0.113.42");
assert(ipPinned.matchedBy === "ip" && ipPinned.hostname === "wx.shuangyue.space", "IP rule beats hostname and priority wins");
assert(ipPinned.contacts.length === 2 && !JSON.stringify(ipPinned).includes("163.com"), "IP profile keeps contact filtering");
const ipWide = await siteWithIp("203.0.113.7");
assert(ipWide.hostname === "ip-target.shuangyue.space" && ipWide.contacts[0]?.type === "email", "CIDR rule selects target profile");
const ipV6 = await siteWithIp("2001:db8:0:1::5");
assert(ipV6.matchedBy === "ip" && ipV6.hostname === "ip-target.shuangyue.space", "IPv6 rule selects target profile");
const ipMiss = await siteWithIp("198.51.100.9");
assert(ipMiss.matchedBy === "host" && ipMiss.hostname === "about.shuangyue.space", "unmatched IP falls back to hostname");
const ipSpoof = await siteWithIp("", { "X-Forwarded-For": "203.0.113.42" });
assert(ipSpoof.matchedBy === "host" && ipSpoof.hostname === "about.shuangyue.space", "X-Forwarded-For cannot select a profile");

// 19. Admin rule CRUD, cache invalidation, and vCard cache policy
const ipLogin = await handleAdmin(await adminReq("/api/admin/login", { method: "POST", body: { password: "pw-for-test" } }), ipEnv);
const ipToken = (ipLogin.headers.get("set-cookie") || "").match(/sfsy_admin=([^;]+)/)?.[1] || "";
const ipAdmin = `sfsy_admin=${ipToken}`;
assert(ipLogin.status === 200 && ipToken, "admin login works for IP rules");
const ipList = await (await handleAdmin(await adminReq("/api/admin/ip-profiles", { cookie: ipAdmin }), ipEnv)).json();
assert(ipList.rules?.length === 3, "admin lists all IP rules");
const ipTest = await (await handleAdmin(await adminReq("/api/admin/ip-profiles/test?ip=203.0.113.42&hostname=about.shuangyue.space", { cookie: ipAdmin }), ipEnv)).json();
assert(ipTest.matched && ipTest.effectiveHostname === "wx.shuangyue.space", "admin test endpoint reports effective profile");
const duplicate = await handleAdmin(await adminReq("/api/admin/ip-profiles", { method: "POST", body: { rule: { selector: "203.0.113.0/24", targetHostname: "qq.shuangyue.space", priority: 1 } }, cookie: ipAdmin }), ipEnv);
assert(duplicate.status === 409, "duplicate normalized CIDR rejected");
const createdRes = await handleAdmin(await adminReq("/api/admin/ip-profiles", { method: "POST", body: { rule: { selector: "198.51.100.7/24", targetHostname: "qq.shuangyue.space", priority: 10, note: "test" } }, cookie: ipAdmin }), ipEnv);
const created = await createdRes.json();
assert(createdRes.status === 200 && created.rule?.selector === "198.51.100.0/24", "admin creates canonical CIDR rule");
const ipNew = await siteWithIp("198.51.100.8");
assert(ipNew.hostname === "qq.shuangyue.space" && ipNew.contacts[0]?.type === "qq", "new rule invalidates cache and applies immediately");
const disableRes = await handleAdmin(await adminReq(`/api/admin/ip-profiles/${encodeURIComponent(created.rule.id)}`, { method: "PUT", body: { rule: { ...created.rule, enabled: false } }, cookie: ipAdmin }), ipEnv);
assert(disableRes.status === 200, "admin disables IP rule");
const ipDisabled = await siteWithIp("198.51.100.8");
assert(ipDisabled.hostname === "about.shuangyue.space", "disabled rule falls back to hostname");
const deleteRes = await handleAdmin(await adminReq(`/api/admin/ip-profiles/${encodeURIComponent(created.rule.id)}`, { method: "DELETE", cookie: ipAdmin }), ipEnv);
assert(deleteRes.status === 200, "admin deletes IP rule");
const ipAfterDelete = await siteWithIp("198.51.100.8");
assert(ipAfterDelete.hostname === "about.shuangyue.space", "deleted rule no longer applies");
const ipVcard = await handleVcard(new Request("https://about.shuangyue.space/contact.vcf", { headers: { "CF-Connecting-IP": "203.0.113.42" } }), ipEnv);
assert(ipVcard.headers.get("cache-control") === "no-store", "IP-sensitive vCard is never cached");

if (failures.length) {
  console.error(`\ncheck-site-profiles failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`\nAll site-profile checks passed (${new Date().toISOString()}).`);
