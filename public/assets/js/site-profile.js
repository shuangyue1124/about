// Site profile pure utilities (no DOM).
// Keep in sync with worker.js (Cloudflare runtime cannot import from assets/).
// Single source of truth for templates, defaults, hostname normalization,
// contact filtering, travel filtering and auto language scoring.

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

export function normalizeHostname(value) {
  return String(value || "").trim().toLowerCase().replace(/\.$/, "");
}

export function templateModules(template, override) {
  if (Array.isArray(override) && override.length) {
    return override.filter((m) => MODULE_IDS.includes(m));
  }
  return [...(TEMPLATES[template] || TEMPLATES.full)];
}

// Built-in fallback profiles used when D1 has no row for a hostname.
// Values here must stay non-sensitive except contacts below (server-side only).
export function defaultProfileFor(hostname) {
  const host = normalizeHostname(hostname);
  const base = {
    hostname: host || "about.shuangyue.space",
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

// Travel filtering is applied to the static city list (data.js stays canonical).
// mode: disabled -> []; all -> all; include -> only listed; exclude -> all except listed.
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

// Auto language scoring: browser lang weight 5, timezone weight 3, cf country weight 3.
// Tie -> browser language wins. Returns "zh" | "ja" | "en".
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
  if (t === "Asia/Shanghai" || t === "Asia/Chongqing" || t === "Asia/Harbin" || t === "Asia/Urumqi" || t === "Asia/Hong_Kong" || t === "Asia/Taipei" || t === "Asia/Macau") return "zh";
  // Other Asia zones lean zh only for CN-adjacent; default others to en-leaning via country signal.
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
