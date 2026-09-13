// Site profile regression: hostname resolution, contact filtering, travel modes, language.
// Run: node scripts/check-site-profiles.mjs
import {
  defaultProfileFor,
  filterContacts,
  filterTravelCities,
  normalizeHostname,
  resolveAutoLanguage,
  sanitizeProfile,
} from "../assets/js/site-profile.js";
import { handleSite } from "../worker.js";

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

// 1. Hostname normalization
assert(normalizeHostname("WX.ShuangYue.Space.") === "wx.shuangyue.space", "hostname normalized (lowercase + trailing dot)");
assert(normalizeHostname(" About.Shuangyue.Space ") === "about.shuangyue.space", "hostname trimmed");

// 2. Default profiles per hostname
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

// 3. Unknown hostname falls back safely (full default, no crash)
const unknown = defaultProfileFor("evil.example.com");
assert(unknown.hostname === "evil.example.com" && unknown.template === "full", "unknown hostname gets safe fallback");

// 4. Contact filtering: wx only wechat/qq
const wxContacts = filterContacts(ALL_CONTACTS, wx.contacts);
assert(wxContacts.length === 2 && wxContacts.every((c) => ["wechat", "qq"].includes(c.type)), "wx profile returns only wechat/qq");
assert(!wxContacts.some((c) => ["telegram", "email", "steam"].includes(c.type)), "wx profile excludes telegram/email/steam");
const wxValues = JSON.stringify(wxContacts);
assert(!wxValues.includes("@x") && !wxValues.includes("a@b.c"), "hidden contact values absent from wx payload");

// 5. Travel modes
const slugs = ["beijing", "luoyang", "japan-2026", "tianjin"];
assert(filterTravelCities(slugs, { mode: "disabled", cities: [] }).length === 0, "travel disabled hides all");
assert(filterTravelCities(slugs, { mode: "all", cities: [] }).length === 4, "travel all shows all");
assert(filterTravelCities(slugs, { mode: "include", cities: ["beijing", "luoyang", "japan-2026"] }).join(",") === "beijing,luoyang,japan-2026", "travel include shows only selected");
assert(filterTravelCities(slugs, { mode: "exclude", cities: ["luoyang"] }).join(",") === "beijing,japan-2026,tianjin", "travel exclude hides blocked");

// 6. Language auto: browser weight 5 wins ties; timezone + geo assist
assert(resolveAutoLanguage({ browserLang: "zh-CN", timezone: "Asia/Shanghai", cfCountry: "CN" }) === "zh", "zh browser+tz+geo -> zh");
assert(resolveAutoLanguage({ browserLang: "ja-JP", timezone: "Asia/Tokyo", cfCountry: "JP" }) === "ja", "ja signals -> ja");
assert(resolveAutoLanguage({ browserLang: "en-US", timezone: "America/New_York", cfCountry: "US" }) === "en", "en signals -> en");
assert(resolveAutoLanguage({ browserLang: "zh-CN", timezone: "America/New_York", cfCountry: "US" }) === "zh", "browser language wins tie (zh vs en)");
assert(resolveAutoLanguage({ browserLang: "en", timezone: "Asia/Tokyo", cfCountry: "JP" }) === "ja", "tz+geo (6) can outweigh single browser vote (5)");

// 7. sanitizeProfile never trusts arbitrary host input for config generation
const evil = sanitizeProfile({ hostname: "EVIL.Example.COM.", template: "contact", language: "zh", modules: ["profile", "contacts", "hacker"], contacts: ["qq", "telegram", "evil"], travel: { mode: "include", cities: ["Beijing", "  "] } }, "about.shuangyue.space");
assert(evil.hostname === "evil.example.com", "sanitize normalizes hostname");
assert(!evil.modules.includes("hacker") && evil.modules.includes("profile"), "sanitize drops unknown modules");
assert(evil.contacts.join(",") === "qq,telegram", "sanitize drops unknown contact types");

// 8. Live /api/site isolation with empty env (defaults only, no D1/KV)
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

if (failures.length) {
  console.error(`\ncheck-site-profiles failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`\nAll site-profile checks passed (${new Date().toISOString()}).`);
