// Site profile 纯工具（无 DOM，可同时用于浏览器与 Node 检查脚本）。
// 与 worker.js 中的服务端实现保持同构：Cloudflare 运行时不从 assets/ import，
// 因此 worker.js 内保留一份拷贝，修改时请两边同步。
// 单一事实来源：模板、默认 Profile、hostname 规范化、联系方式过滤、旅行过滤、自动语言评分。

export const PROFILE_CACHE_TTL_SECONDS = 60;

export const TEMPLATES = {
  full: ["profile", "about", "contacts", "travel", "anime", "games", "github", "comments"],
  contact: ["profile", "contacts"],
  social: ["profile", "contacts", "comments"],
  travel: ["profile", "travel"],
  projects: ["profile", "github"],
  minimal: ["profile"],
  custom: [],
};

export const MODULE_IDS = ["profile", "about", "contacts", "travel", "anime", "games", "github", "comments"];

export const CONTACT_TYPES = [
  "wechat",
  "qq",
  "telegram",
  "github",
  "email",
  "steam",
  "minecraft",
  "genshin",
  "website",
  "bilibili",
  "x",
  "instagram",
  "discord",
  "custom",
];

export const CONTENT_TYPES = ["anime", "game", "github", "movie", "book", "music", "software", "project"];

export function normalizeHostname(value) {
  return String(value || "").trim().toLowerCase().replace(/\.$/, "");
}

export function templateModules(template, override) {
  if (Array.isArray(override) && override.length) {
    return override.filter((m) => MODULE_IDS.includes(m));
  }
  return [...(TEMPLATES[template] || TEMPLATES.full)];
}

// 内置 fallback：D1 无对应 hostname 行时使用。仅含非敏感默认，
// 真实敏感联系值由服务端 DEFAULT_CONTACTS / D1 contact_items 提供，前端不得硬编码。
export function defaultProfileFor(hostname) {
  const host = normalizeHostname(hostname) || "about.shuangyue.space";
  const base = {
    hostname: host,
    enabled: true,
    template: "full",
    language: "auto",
    modules: [...TEMPLATES.full],
    contacts: ["qq", "telegram", "email", "github", "steam"],
    travel: { mode: "all", cities: [] },
    githubUser: "shuangyue1124",
    title: null,
    subtitle: null,
  };
  if (host === "wx.shuangyue.space") {
    return {
      ...base, hostname: host, template: "contact", modules: [...TEMPLATES.contact],
      contacts: ["wechat", "qq"], travel: { mode: "disabled", cities: [] },
    };
  }
  if (host === "qq.shuangyue.space") {
    return {
      ...base, hostname: host, template: "contact", modules: [...TEMPLATES.contact],
      contacts: ["qq"], travel: { mode: "disabled", cities: [] },
    };
  }
  if (host === "github.shuangyue.space") {
    return {
      ...base, hostname: host, template: "projects", modules: [...TEMPLATES.projects],
      contacts: ["github"], travel: { mode: "disabled", cities: [] },
    };
  }
  if (host === "travel.shuangyue.space") {
    return {
      ...base, hostname: host, template: "travel", modules: [...TEMPLATES.travel],
      contacts: [], travel: { mode: "all", cities: [] },
    };
  }
  return base;
}

export function sanitizeProfile(input, fallbackHostname) {
  const fallback = defaultProfileFor(fallbackHostname || input?.hostname);
  const hostname = normalizeHostname(input?.hostname || fallback.hostname);
  const template = typeof input?.template === "string" && (TEMPLATES[input.template] || input.template === "custom")
    ? input.template
    : "full";
  const language = ["auto", "zh", "ja", "en"].includes(input?.language) ? input.language : "auto";
  const modules = Array.isArray(input?.modules) && input.modules.length
    ? input.modules.filter((m) => MODULE_IDS.includes(m))
    : templateModules(template);
  const contacts = Array.isArray(input?.contacts)
    ? [...new Set(input.contacts.map((c) => String(c).toLowerCase()).filter((c) => CONTACT_TYPES.includes(c)))]
    : [...fallback.contacts];
  const travelRaw = input?.travel && typeof input.travel === "object" ? input.travel : {};
  const mode = ["disabled", "all", "include", "exclude"].includes(travelRaw.mode) ? travelRaw.mode : "all";
  const cities = Array.isArray(travelRaw.cities)
    ? [...new Set(travelRaw.cities.map((s) => String(s).toLowerCase().trim()).filter(Boolean))].slice(0, 200)
    : [];
  return {
    hostname,
    enabled: input?.enabled !== false,
    template,
    language,
    modules,
    contacts,
    travel: { mode, cities },
    githubUser: String(input?.githubUser || fallback.githubUser || "shuangyue1124").slice(0, 64) || "shuangyue1124",
    title: input?.title && typeof input.title === "object" ? input.title : null,
    subtitle: input?.subtitle && typeof input.subtitle === "object" ? input.subtitle : null,
    updatedAt: input?.updatedAt || "",
  };
}

export function filterContacts(allContacts, allowedTypes) {
  const allow = new Set((allowedTypes || []).map((c) => String(c).toLowerCase()));
  return (allContacts || [])
    .filter((c) => c && c.enabled !== false && allow.has(String(c.type || "").toLowerCase()))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((c) => ({ type: c.type, label: c.label, value: c.value, url: c.url || "" }));
}

// 旅行过滤作用于静态城市 slug 列表（data.js 保持权威）。
// disabled -> []；all -> 全部；include -> 仅所选；exclude -> 除屏蔽外全部。
export function filterTravelCities(allSlugs, travel) {
  if (!travel || travel.mode === "disabled") return [];
  if (travel.mode === "include") {
    const allow = new Set((travel.cities || []).map((s) => String(s).toLowerCase()));
    return (allSlugs || []).filter((s) => allow.has(String(s).toLowerCase()));
  }
  if (travel.mode === "exclude") {
    const block = new Set((travel.cities || []).map((s) => String(s).toLowerCase()));
    return (allSlugs || []).filter((s) => !block.has(String(s).toLowerCase()));
  }
  return [...(allSlugs || [])];
}

// 自动语言评分：浏览器语言权重 5，时区权重 3，CF 国家权重 3。平手时浏览器语言优先。
export function resolveAutoLanguage({ browserLang = "", timezone = "", cfCountry = "" } = {}) {
  const bl = normalizeLangCode(browserLang);
  const scores = { zh: 0, ja: 0, en: 0 };
  if (bl) scores[bl] += 5;
  const tzLang = langFromTimezone(timezone);
  if (tzLang) scores[tzLang] += 3;
  const geoLang = langFromCountry(cfCountry);
  if (geoLang) scores[geoLang] += 3;
  let best = bl || "zh";
  let bestScore = -1;
  for (const lang of ["zh", "ja", "en"]) {
    if (scores[lang] > bestScore) {
      bestScore = scores[lang];
      best = lang;
    }
  }
  return best;
}

export function normalizeLangCode(value) {
  const v = String(value || "").toLowerCase().replace("_", "-");
  if (!v) return "";
  if (v.startsWith("ja")) return "ja";
  if (v.startsWith("en")) return "en";
  if (v.startsWith("zh")) return "zh";
  return "";
}

export function langFromTimezone(tz) {
  const t = String(tz || "");
  if (!t) return "";
  if (t === "Asia/Tokyo") return "ja";
  if (
    t === "Asia/Shanghai" || t === "Asia/Chongqing" || t === "Asia/Harbin" ||
    t === "Asia/Urumqi" || t === "Asia/Hong_Kong" || t === "Asia/Taipei" || t === "Asia/Macau"
  ) return "zh";
  return "";
}

export function langFromCountry(country) {
  const c = String(country || "").toUpperCase();
  if (!c) return "";
  if (c === "CN" || c === "HK" || c === "MO" || c === "TW" || c === "SG") return "zh";
  if (c === "JP") return "ja";
  return "en";
}

export function resolveEffectiveLang(profileLanguage, signals) {
  if (profileLanguage === "zh" || profileLanguage === "ja" || profileLanguage === "en") return profileLanguage;
  return resolveAutoLanguage(signals || {});
}
