export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/site" || url.pathname === "/api/site/") {
      return handleSite(request, env);
    }

    if (url.pathname === "/api/content" || url.pathname === "/api/content/") {
      return handleContent(request, env);
    }

    if (url.pathname === "/api/events" || url.pathname === "/api/events/") {
      return handleEvents(request, env);
    }

    if (url.pathname.startsWith("/api/admin")) {
      return handleAdmin(request, env, ctx);
    }

    if (url.pathname === "/api/comments" || url.pathname === "/api/comments/") {
      return handleComments(request, env, ctx);
    }

    if (url.pathname === "/api/csp-report" || url.pathname === "/api/csp-report/") {
      return handleCspReport(request);
    }

    // Dynamic vCard: /contact.vcf (user entry, kept) and /api/contact.vcf
    // (explicit API alias) both serve per-hostname filtered contacts.
    // Worker runs first (run_worker_first), so the static public/contact.vcf
    // never preempts this. Static file remains only as catch fallback.
    if ((url.pathname === "/contact.vcf" || url.pathname === "/assets/shuofeng-shuanyue.vcf" || url.pathname === "/api/contact.vcf" || url.pathname === "/api/contact.vcf/") && request.method === "GET") {
      try {
        return await handleVcard(request, env);
      } catch {
        // Fall through to static assets below.
      }
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return env.ASSETS.fetch(request);
    }

    const paths = assetCandidates(url.pathname);

    for (const path of paths) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = path;
      const response = await env.ASSETS.fetch(new Request(assetUrl, request));
      if (response.status !== 404) return response;
    }

    return env.ASSETS.fetch(request);
  },

  // Cron maintenance for Worker runtimes only (wrangler dev / wrangler deploy).
  // It does NOT run on the production Cloudflare Pages deployment: Pages Git
  // integration serves public/ plus the file-routed functions/ handlers, and
  // Pages Functions have no scheduled-event wiring, so wrangler.jsonc triggers
  // are ignored there. Production cleanup relies on the authenticated admin
  // button (POST /api/admin/cleanup-events). Cloudflare Cron runs in UTC; the
  // cutoff below is an absolute instant, so no CST/UTC confusion is possible.
  // The school timetable is client-side only and is never touched by this.
  async scheduled(event, env, ctx) {
    if (!env.COMMENTS_DB) return;
    const days = EVENT_RETENTION_DAYS_DEFAULT;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const result = await env.COMMENTS_DB.prepare("DELETE FROM site_events WHERE created_at < ?").bind(cutoff).run();
      console.log(`[scheduled cleanup] deleted ${result.meta?.changes || 0} site_events older than ${cutoff}`);
    } catch (error) {
      console.error("[scheduled cleanup] failed", error?.message || error);
    }
  },
};

function assetCandidates(pathname) {
  const paths = [pathname];

  if (pathname === "/") {
    paths.push("/index.html");
  } else if (pathname.endsWith("/")) {
    paths.push(`${pathname}index.html`);
  } else if (pathname.endsWith(".html")) {
    paths.push(pathname.slice(0, -5));
  } else if (!pathname.split("/").pop().includes(".")) {
    paths.push(`${pathname}.html`, `${pathname}/index.html`);
  }

  return [...new Set(paths)];
}

const LEGACY_COMMENT_INDEX_KEY = "comments:index";
const APPROVED_COMMENTS_CACHE_KEY = "comments:approved:v1";
const SITE_SETTINGS_KEY = "site:settings";
const SITE_CONFIG_KEY = "site";
const ADMIN_COOKIE_NAME = "sfsy_admin";
const ADMIN_PASSWORD_KEYS = ["ADMIN_PASSWORD", "ADMIN_SECRET", "SFSY_ADMIN_PASSWORD", "SITE_ADMIN_PASSWORD"];
const ADMIN_SECRET_STORE_KEYS = ["SECRETS", "SECRET_STORE", "ADMIN_SECRETS"];
const DEFAULT_MODERATION_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const DEFAULT_CHAT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const MAX_STORED_COMMENTS = 100;
const DEFAULT_LIST_LIMIT = 30;
const ADMIN_SESSION_SECONDS = 60 * 60 * 24;
const DEFAULT_CACHE_TTL_SECONDS = 60;
const DEFAULT_MEMORY_TTL_SECONDS = 15;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const RATE_LIMIT_PREFIX = "rl";
const EVENTS_RATE_LIMITS = [
  { limit: 60, windowSeconds: 60 },
  { limit: 240, windowSeconds: 600 },
];
const COMMENTS_RATE_LIMITS = [
  { limit: 5, windowSeconds: 60 },
  { limit: 20, windowSeconds: 600 },
];
const LOGIN_FAILURE_LIMIT = { max: 5, windowSeconds: 300 };
const AI_CHAT_RATE_LIMITS = [{ limit: 30, windowSeconds: 60 }];
const ALLOWED_EVENT_TYPES = new Set(["page_view"]);
const ALLOWED_EVENT_PAGES = new Set(["home", "travel", "city", "trip", "anime", "games", "github", "content"]);
const ALLOWED_EVENT_LANGS = new Set(["zh", "ja", "en"]);
const MAX_EVENT_BODY_BYTES = 4096;
const MAX_COMMENT_BODY_BYTES = 8192;
const TELEGRAM_API_TIMEOUT_MS = 8000;
const TELEGRAM_TEST_LIMIT = { limit: 3, windowSeconds: 60 };
const AI_CHAT_TIMEOUT_MS = 24000;
const EVENT_RETENTION_DAYS_DEFAULT = 90;
const EVENT_RETENTION_DAYS_MIN = 7;
const EVENT_RETENTION_DAYS_MAX = 365;

const memory = {
  comments: null,
  commentsExpiresAt: 0,
  config: null,
  configExpiresAt: 0,
  schemaReady: false,
  // Site profiles: hostname -> { profile, expiresAt }. Per-isolate only (0 KV writes
  // on the hot path); KV holds a 60s JSON copy for cross-isolate reuse, D1 is source.
  profiles: new Map(),
  contacts: null,
  contactsExpiresAt: 0,
  // Per-isolate fixed-window counters for high-frequency endpoints.
  // /api/events fires on every page view, so it must never touch KV per
  // request: KV Free allows only 1,000 writes/day (reset 00:00 UTC, hard fail),
  // and 500 page views would already exhaust that with 2 KV writes each.
  // Memory-only limiting costs 0 KV ops on the hot path; KV is retained only
  // for low-volume scopes (comments/login/ai-chat/telegram-test).
  rateLimits: new Map(),
};

// --- Multi-hostname site profiles (incremental, no rewrite) ---
// Keep in sync with assets/js/site-profile.js (same defaults + sanitizers).
const PROFILE_CACHE_TTL_SECONDS = 60;
const TEMPLATE_MODULES = {
  full: ["profile", "about", "contacts", "travel", "anime", "games", "github", "comments"],
  contact: ["profile", "contacts"],
  social: ["profile", "contacts", "comments"],
  travel: ["profile", "travel"],
  projects: ["profile", "github"],
  minimal: ["profile"],
  custom: [],
};
const MODULE_IDS = ["profile", "about", "contacts", "travel", "anime", "games", "github", "comments"];
const CONTACT_TYPES = ["wechat", "qq", "telegram", "github", "email", "steam", "minecraft", "genshin", "website", "bilibili", "x", "instagram", "discord", "custom"];
const CONTENT_TYPES = ["anime", "game", "github", "movie", "book", "music", "software", "project"];
const GITHUB_SCAN_TIMEOUT_MS = 12000;
const AI_REVIEW_TIMEOUT_MS = 30000;

// Server-side contact catalog defaults (single source for sensitive values).
// Public /api/site only returns the subset allowed by the current hostname profile.
const DEFAULT_CONTACTS = [
  { type: "wechat", label: "微信", value: "sfsy1124", url: "", enabled: true, sortOrder: 10 },
  { type: "qq", label: "QQ", value: "3238097745", url: "", enabled: true, sortOrder: 20 },
  { type: "telegram", label: "Telegram", value: "@sfsy1124", url: "https://t.me/sfsy1124", enabled: true, sortOrder: 30 },
  { type: "github", label: "GitHub", value: "shuangyue1124", url: "https://github.com/shuangyue1124", enabled: true, sortOrder: 40 },
  { type: "email", label: "Email", value: "hzq101116@163.com", url: "mailto:hzq101116@163.com", enabled: true, sortOrder: 50 },
  { type: "steam", label: "Steam", value: "CS2 Profile", url: "https://steamcommunity.com/profiles/76561199258450245/", enabled: true, sortOrder: 60 },
  { type: "minecraft", label: "Minecraft", value: "CN_YangYang", url: "", enabled: true, sortOrder: 70 },
  { type: "genshin", label: "原神", value: "847045298", url: "", enabled: true, sortOrder: 80 },
];

function normalizeHostname(value) {
  return String(value || "").trim().toLowerCase().replace(/\.$/, "");
}

function requestHostname(request) {
  try {
    return normalizeHostname(new URL(request.url).hostname);
  } catch {
    return "";
  }
}

function defaultProfileFor(hostname) {
  const host = normalizeHostname(hostname) || "about.shuangyue.space";
  const base = {
    hostname: host, enabled: true, template: "full", language: "auto",
    modules: [...TEMPLATE_MODULES.full],
    contacts: ["qq", "telegram", "email", "github", "steam"],
    travel: { mode: "all", cities: [] },
    githubUser: "shuangyue1124", title: null, subtitle: null,
  };
  if (host === "wx.shuangyue.space") {
    return { ...base, hostname: host, template: "contact", modules: [...TEMPLATE_MODULES.contact], contacts: ["wechat", "qq"], travel: { mode: "disabled", cities: [] } };
  }
  if (host === "qq.shuangyue.space") {
    return { ...base, hostname: host, template: "contact", modules: [...TEMPLATE_MODULES.contact], contacts: ["qq"], travel: { mode: "disabled", cities: [] } };
  }
  if (host === "github.shuangyue.space") {
    return { ...base, hostname: host, template: "projects", modules: [...TEMPLATE_MODULES.projects], contacts: ["github"], travel: { mode: "disabled", cities: [] } };
  }
  if (host === "travel.shuangyue.space") {
    return { ...base, hostname: host, template: "travel", modules: [...TEMPLATE_MODULES.travel], contacts: [], travel: { mode: "all", cities: [] } };
  }
  return base;
}

function sanitizeProfile(input, fallbackHostname) {
  const fallback = defaultProfileFor(fallbackHostname || input?.hostname);
  const hostname = normalizeHostname(input?.hostname || fallback.hostname);
  const template = typeof input?.template === "string" && (TEMPLATE_MODULES[input.template] || input.template === "custom") ? input.template : "full";
  const language = ["auto", "zh", "ja", "en"].includes(input?.language) ? input.language : "auto";
  const modules = Array.isArray(input?.modules) && input.modules.length
    ? input.modules.filter((m) => MODULE_IDS.includes(m))
    : [...(TEMPLATE_MODULES[template] || TEMPLATE_MODULES.full)];
  const contacts = Array.isArray(input?.contacts)
    ? [...new Set(input.contacts.map((c) => String(c).toLowerCase()).filter((c) => CONTACT_TYPES.includes(c)))]
    : [...fallback.contacts];
  const travelRaw = input?.travel && typeof input.travel === "object" ? input.travel : {};
  const mode = ["disabled", "all", "include", "exclude"].includes(travelRaw.mode) ? travelRaw.mode : "all";
  const cities = Array.isArray(travelRaw.cities)
    ? [...new Set(travelRaw.cities.map((s) => String(s).toLowerCase().trim()).filter(Boolean))].slice(0, 200)
    : [];
  return {
    hostname, enabled: input?.enabled !== false, template, language, modules, contacts,
    travel: { mode, cities },
    githubUser: String(input?.githubUser || fallback.githubUser || "shuangyue1124").slice(0, 64) || "shuangyue1124",
    title: input?.title && typeof input.title === "object" ? input.title : null,
    subtitle: input?.subtitle && typeof input.subtitle === "object" ? input.subtitle : null,
    updatedAt: input?.updatedAt || "",
  };
}

function filterContactsForProfile(allContacts, profile) {
  const allow = new Set((profile?.contacts || []).map((c) => String(c).toLowerCase()));
  return (allContacts || [])
    .filter((c) => c && c.enabled !== false && allow.has(String(c.type || "").toLowerCase()))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((c) => ({ type: c.type, label: c.label, value: c.value, url: c.url || "" }));
}

function filterTravelSlugs(allSlugs, travel) {
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

// Cache isolation: every profile/content key embeds the normalized hostname
// (equiv. site:{hostname} / content:{hostname}:{type} / content-detail:{hostname}:{type}:{slug}).
// There is intentionally NO global "site" / "content:github" key: profiles use
// profile:v1:{hostname} in both memory (Map) and KV; content is read from D1
// per request and gated per hostname, never cached globally, so wx/qq/about
// can never read each other's entries through a shared cache.
function profileCacheKey(hostname) {
  return `profile:v1:${normalizeHostname(hostname) || "about.shuangyue.space"}`;
}

const DEFAULT_SITE_CONFIG = {
  commentsEnabled: true,
  moderationEnabled: true,
  migrationEnabled: true,
  aiModel: DEFAULT_MODERATION_MODEL,
  aiChatModel: DEFAULT_CHAT_MODEL,
  approvedCacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
  memoryCacheTtlSeconds: DEFAULT_MEMORY_TTL_SECONDS,
  turnstileSiteKey: "",
  title: {
    zh: "朔风霜月",
    ja: "朔風霜月",
    en: "Shuofeng Shuanyue",
  },
  subtitle: {
    zh: "在像素世界、旅途与代码里收集灵感。",
    ja: "ピクセルの世界、旅、コードの中でひらめきを集めています。",
    en: "Collecting sparks from pixel worlds, open roads, and code.",
  },
  documentTitle: {
    zh: "朔风霜月 | NFC 名片",
    ja: "朔風霜月 | NFCカード",
    en: "Shuofeng Shuanyue | NFC Card",
  },
  notice: {
    zh: "",
    ja: "",
    en: "",
  },
};

export async function handleComments(request, env, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: publicApiHeaders() });

  try {
    if (request.method === "GET") {
      // Display control only (no 404 in this phase): a hostname whose profile
      // excludes the comments module gets an empty public list, same as content.
      const profile = await loadSiteProfile(env, requestHostname(request));
      if (profile.enabled && !profile.modules.includes("comments")) {
        return json({ comments: [] });
      }
      const limit = commentLimit(new URL(request.url).searchParams.get("limit"));
      const comments = await listApprovedComments(env, limit);
      return json({ comments });
    }

    if (request.method === "POST") {
      const config = await loadSiteConfig(env);
      if (!config.commentsEnabled) return json({ error: "comments are closed" }, 403);

      // Cheap abuse guard before parsing: reject oversized bodies early.
      const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10) || 0;
      if (contentLength > MAX_COMMENT_BODY_BYTES) return json({ error: "payload too large" }, 413);

      const payload = await request.json().catch(() => ({}));
      if (payload.website) return json({ ok: true, status: "pending" }, 202);

      const name = cleanOneLine(payload.name, 32);
      const message = cleanMessage(payload.message, 500);
      if (!name || !message) return json({ error: "name and message are required" }, 400);

      const rate = await rateLimitCheck(env, "comments", clientIp(request), COMMENTS_RATE_LIMITS);
      if (rate.limited) return rateLimitedResponse(rate.retryAfter);

      const turnstile = await verifyTurnstile(request, env, payload.turnstileToken || payload["cf-turnstile-response"]);
      if (!turnstile.ok) return json({ error: "turnstile verification failed", codes: turnstile.errorCodes }, turnstile.status);

      const moderation = config.moderationEnabled
        ? await moderateComment(env, config, { name, message })
        : { safe: true, model: "", raw: { skipped: true }, categories: [], reason: "" };

      const now = new Date().toISOString();
      const comment = {
        id: crypto.randomUUID(),
        name,
        message,
        ip: clientIp(request),
        ipLocation: clientLocation(request),
        status: moderation.safe ? "approved" : "pending",
        moderationModel: moderation.model || config.aiModel,
        moderationResult: JSON.stringify(moderation.raw || {}),
        moderationCategories: moderation.categories?.join(", ") || "",
        moderationReason: moderation.reason || "",
        moderationError: moderation.error || "",
        createdAt: now,
        updatedAt: now,
        reviewedAt: moderation.safe ? now : "",
      };

      await saveComment(env, comment);
      if (comment.status === "approved") await refreshApprovedCommentsCache(env);

      // Auxiliary side effect only: the comment is already persisted. A
      // Telegram failure must never roll it back or delay the visitor, so the
      // notification runs in the background and swallows its own errors.
      const telegramText = buildTelegramMessage(comment, {
        page: refererPage(request),
        lang: refererLang(request),
      });
      const notify = sendTelegramNotification(env, telegramText).catch((error) => {
        console.error("[telegram] notification failed", error?.message || error);
      });
      if (ctx?.waitUntil) ctx.waitUntil(notify);
      else notify.catch(() => {});

      return json({ comment: publicComment(comment), status: comment.status }, comment.status === "approved" ? 201 : 202);
    }

    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function handleSite(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: publicApiHeaders() });
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
  try {
    const hostname = requestHostname(request);
    const settings = await loadSiteConfig(env);
    const profile = await loadSiteProfile(env, hostname);
    const allContacts = await loadAllContacts(env);
    const contacts = filterContactsForProfile(allContacts, profile);
    const cf = request.cf || {};
    return json({
      settings: publicSiteSettings(settings),
      hostname: profile.hostname,
      profile: {
        hostname: profile.hostname,
        template: profile.template,
        language: profile.language,
        modules: profile.enabled ? profile.modules : ["profile"],
        travel: profile.travel,
        githubUser: profile.githubUser,
        title: profile.title,
        subtitle: profile.subtitle,
        enabled: profile.enabled,
      },
      contacts,
      travel: profile.travel,
      geo: {
        country: String(cf.country || ""),
        timezone: String(cf.timezone || ""),
        city: String(cf.city || ""),
      },
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function handleContent(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: publicApiHeaders() });
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
  try {
    const url = new URL(request.url);
    const rawType = cleanOneLine(url.searchParams.get("type"), 20).toLowerCase();
    const slug = cleanOneLine(url.searchParams.get("slug"), 120).toLowerCase();
    const hostname = requestHostname(request);
    const profile = await loadSiteProfile(env, hostname);
    // A hostname whose modules exclude e.g. github must not receive github items.
    const moduleFor = (t) => {
      if (t === "anime") return "anime";
      if (t === "game") return "games";
      if (t === "github" || t === "project" || t === "software") return "github";
      return "";
    };
    const gateType = rawType && rawType !== "all" ? rawType : "";
    if (gateType) {
      const need = moduleFor(gateType);
      if (need && profile.enabled && !profile.modules.includes(need)) {
        // Gated module: list callers get an empty result, detail callers get
        // a 404 (never confirm whether the slug exists on another hostname).
        if (slug) return json({ error: "not found" }, 404);
        return json({ items: [] });
      }
    }
    const items = await listContentItems(env, rawType || "all", true);
    // Further gate mixed "all" responses so wx/qq/about/github/travel can never
    // read each other's filtered lists through one shared endpoint.
    const gated = profile.enabled ? items.filter((item) => {
      const need = moduleFor(item.type);
      return !need || profile.modules.includes(need);
    }) : [];
    if (slug) {
      const found = gated.find((i) => String(i.slug).toLowerCase() === slug && (!gateType || gateType === "all" || i.type === gateType));
      if (!found) return json({ error: "not found" }, 404);
      return json({ item: publicContentItem(found) });
    }
    return json({ items: gated.map(publicContentItem) });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function handleVcard(request, env) {
  const hostname = requestHostname(request);
  const profile = await loadSiteProfile(env, hostname);
  const allContacts = await loadAllContacts(env);
  const contacts = filterContactsForProfile(allContacts, profile);
  const body = buildVcard(contacts);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "cache-control": "private, max-age=60",
      "content-disposition": 'inline; filename="shuofeng-shuanyue.vcf"',
    },
  });
}

function escapeVcard(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,").slice(0, 500);
}

function buildVcard(contacts) {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:朔风霜月",
    "N:朔风霜月;;;;",
    "URL:https://about.shuangyue.space/",
  ];
  for (const c of contacts || []) {
    const type = String(c.type || "").toLowerCase();
    const value = String(c.value || "");
    const url = String(c.url || "");
    if (!value && !url) continue;
    if (type === "email" && value.includes("@")) {
      lines.push(`EMAIL;TYPE=INTERNET:${escapeVcard(value)}`);
    } else if (url.startsWith("http")) {
      lines.push(`X-SOCIALPROFILE;TYPE=${escapeVcard(type)}:${escapeVcard(url)}`);
    } else if (value) {
      lines.push(`X-SOCIALPROFILE;TYPE=${escapeVcard(type)}:${escapeVcard(value)}`);
    }
  }
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

export async function handleEvents(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: publicApiHeaders() });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10) || 0;
  if (contentLength > MAX_EVENT_BODY_BYTES) return json({ error: "payload too large" }, 413);

  const userAgent = cleanOneLine(request.headers.get("user-agent"), 300);
  if (!userAgent) return json({ error: "missing user agent" }, 400);

  // Cheap validation runs before the rate-limit counters so malformed or
  // disallowed payloads cost neither quota nor D1/KV. Flooding with junk
  // therefore cannot burn legitimate clients' quota; only well-formed
  // page_views advance the in-memory windows below (still 0 KV reads/writes).
  if (!env.COMMENTS_DB) return json({ ok: true }, 202);

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return json({ error: "invalid payload" }, 400);

  const type = cleanOneLine(payload.type, 40) || "page_view";
  if (!ALLOWED_EVENT_TYPES.has(type)) return json({ error: "invalid event type" }, 400);

  const page = cleanOneLine(payload.page, 40);
  const lang = cleanOneLine(payload.lang, 12);
  if (page && !ALLOWED_EVENT_PAGES.has(page)) return json({ error: "invalid page value" }, 400);
  if (lang && !ALLOWED_EVENT_LANGS.has(lang)) return json({ error: "invalid lang value" }, 400);

  const rate = memoryRateLimitCheck("events", clientIp(request), EVENTS_RATE_LIMITS);
  if (rate.limited) return rateLimitedResponse(rate.retryAfter);

  try {
    await saveEvent(env, {
      type,
      path: cleanPath(payload.path),
      page,
      lang,
      title: cleanOneLine(payload.title, 120),
      referrer: cleanOneLine(payload.referrer, 300),
      userAgent,
      ip: clientIp(request),
      ipLocation: clientLocation(request),
    });
    return json({ ok: true }, 202);
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function handleCspReport(request) {
  try {
    const body = await request.text();
    console.error(`[csp-report] ${body.slice(0, 4000)}`);
  } catch {
    // Report bodies are best-effort; ignore unreadable payloads.
  }
  return new Response(null, { status: 204 });
}

export async function handleAdmin(request, env, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: adminApiHeaders() });

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/api/admin";

  try {
    if (path === "/api/admin/login" && request.method === "POST") {
      return adminLogin(request, env);
    }

    if (path === "/api/admin/logout" && request.method === "POST") {
      return jsonAdmin({ ok: true }, 200, {
        "set-cookie": `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      });
    }

    const session = await adminSession(request, env);
    if (!session) return jsonAdmin({ error: "unauthorized" }, 401);

    if (request.method !== "GET" && request.headers.get("x-admin-action") !== "1") {
      return jsonAdmin({ error: "missing admin action header" }, 403);
    }

    if ((path === "/api/admin" || path === "/api/admin/me") && request.method === "GET") {
      return jsonAdmin({ ok: true, expiresAt: session.exp * 1000 });
    }

    if (path === "/api/admin/health" && request.method === "GET") {
      return jsonAdmin({ health: await adminHealth(env) });
    }

    if ((path === "/api/admin/config" || path === "/api/admin/settings") && request.method === "GET") {
      const config = await loadSiteConfig(env);
      return jsonAdmin({ config, settings: config });
    }

    if ((path === "/api/admin/config" || path === "/api/admin/settings") && request.method === "PUT") {
      const payload = await request.json().catch(() => ({}));
      const current = await loadSiteConfig(env);
      const config = sanitizeSiteConfig(payload.config || payload, current);
      config.updatedAt = new Date().toISOString();
      await saveSiteConfig(env, config);
      await refreshApprovedCommentsCache(env);
      return jsonAdmin({ config, settings: config });
    }

    if (path === "/api/admin/comments" && request.method === "GET") {
      const limit = commentLimit(url.searchParams.get("limit") || String(MAX_STORED_COMMENTS));
      const status = cleanOneLine(url.searchParams.get("status"), 20) || "all";
      const comments = await listAdminComments(env, limit, status);
      return jsonAdmin({ comments });
    }

    if (path === "/api/admin/migrate-comments" && request.method === "POST") {
      const config = await loadSiteConfig(env);
      if (!config.migrationEnabled) return jsonAdmin({ error: "migration is disabled" }, 403);
      return jsonAdmin({ result: await migrateLegacyComments(env) });
    }

    if (path === "/api/admin/cleanup-events" && request.method === "POST") {
      if (!env.COMMENTS_DB) return jsonAdmin({ error: "D1 event storage is not configured" }, 503);
      const payload = await request.json().catch(() => ({}));
      const days = boundedInt(payload.days, EVENT_RETENTION_DAYS_DEFAULT, EVENT_RETENTION_DAYS_MIN, EVENT_RETENTION_DAYS_MAX);
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const result = await env.COMMENTS_DB.prepare("DELETE FROM site_events WHERE created_at < ?").bind(cutoff).run();
      return jsonAdmin({ ok: true, deleted: result.meta?.changes || 0, cutoff, days });
    }

    if (path === "/api/admin/ai-chat" && request.method === "POST") {
      // Empty messages are rejected before the rate-limit counters so junk or
      // accidental empty posts never burn KV writes.
      const payload = await request.json().catch(() => ({}));
      const message = cleanMessage(payload.message, 1000);
      if (!message) return jsonAdmin({ error: "message is required" }, 400);

      const rate = await adminAiChatRateLimit(request, env);
      if (rate.limited) return rateLimitedResponse(rate.retryAfter, true);

      const result = await adminAiChat(env, message);
      return jsonAdmin({ reply: result.reply, contextMeta: result.contextMeta });
    }

    // Admin-only Telegram test. There is intentionally no public endpoint that
    // can send Telegram messages; this one requires a valid admin session plus
    // the admin action header, and is rate limited per session.
    if (path === "/api/admin/test-telegram" && request.method === "POST") {
      const token = cookieValue(request.headers.get("Cookie"), ADMIN_COOKIE_NAME);
      const sessionId = token ? (await sha256Hex(token)).slice(0, 32) : clientIp(request);
      const rate = await rateLimitCheck(env, "telegram-test", sessionId, [TELEGRAM_TEST_LIMIT]);
      if (rate.limited) return rateLimitedResponse(rate.retryAfter, true);
      const result = await sendTelegramNotification(env, `✅ Telegram 通知测试成功（${formatCst(new Date())}）\n来自 about.shuangyue.space 管理员后台。`);
      if (result.skipped) return jsonAdmin({ error: "telegram is not configured" }, 503);
      if (!result.ok) return jsonAdmin({ error: "telegram send failed" }, 502);
      return jsonAdmin({ ok: true });
    }

    // ---- Site profiles (domain management; same admin auth, no second login) ----
    if (path === "/api/admin/profiles" && request.method === "GET") {
      return jsonAdmin({ profiles: await listSiteProfiles(env) });
    }
    if (path === "/api/admin/profiles" && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      const profile = await saveSiteProfile(env, payload.profile || payload);
      return jsonAdmin({ profile });
    }
    if (path.startsWith("/api/admin/profiles/")) {
      const hostname = normalizeHostname(decodeURIComponent(path.slice("/api/admin/profiles/".length)));
      if (!hostname) return jsonAdmin({ error: "hostname is required" }, 400);
      if (request.method === "GET") {
        return jsonAdmin({ profile: await loadSiteProfile(env, hostname) });
      }
      if (request.method === "PUT") {
        const payload = await request.json().catch(() => ({}));
        const profile = await saveSiteProfile(env, { ...(payload.profile || payload), hostname });
        return jsonAdmin({ profile });
      }
      if (request.method === "DELETE") {
        return jsonAdmin(await deleteSiteProfile(env, hostname));
      }
    }

    // ---- Contact catalog (admin sees all, public sees filtered subset) ----
    if (path === "/api/admin/contacts" && request.method === "GET") {
      return jsonAdmin({ contacts: await loadAllContacts(env, { includeDisabled: true }) });
    }
    if (path === "/api/admin/contacts" && (request.method === "PUT" || request.method === "POST")) {
      const payload = await request.json().catch(() => ({}));
      const contacts = await saveAllContacts(env, payload.contacts || []);
      return jsonAdmin({ contacts });
    }

    // ---- Content items (anime / game / github share one table) ----
    if (path === "/api/admin/content" && request.method === "GET") {
      const type = cleanOneLine(url.searchParams.get("type"), 20) || "all";
      const items = await listContentItems(env, type, false);
      return jsonAdmin({ items: items.map(adminContentItem) });
    }
    if (path === "/api/admin/content" && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      const item = await saveContentItem(env, payload.item || payload);
      return jsonAdmin({ item });
    }
    if (path.startsWith("/api/admin/content/")) {
      const id = decodeURIComponent(path.slice("/api/admin/content/".length));
      if (!id) return jsonAdmin({ error: "content id is required" }, 400);
      if (request.method === "PUT" || request.method === "PATCH") {
        const payload = await request.json().catch(() => ({}));
        const item = await saveContentItem(env, { ...(payload.item || payload), id });
        return jsonAdmin({ item });
      }
      if (request.method === "DELETE") {
        if (url.searchParams.get("permanent") === "1") {
          return jsonAdmin(await hardDeleteContentItem(env, id));
        }
        return jsonAdmin(await deleteContentItem(env, id));
      }
    }

    // ---- GitHub scan (candidates only, admin picks what to import) ----
    if (path === "/api/admin/github/scan" && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      const username = cleanOneLine(payload.username, 64) || (await loadSiteProfile(env, "about.shuangyue.space")).githubUser || "shuangyue1124";
      try {
        return jsonAdmin({ repos: await scanGithubRepos(username) });
      } catch (error) {
        return jsonAdmin({ error: error?.message || "github scan failed" }, 502);
      }
    }
    if (path === "/api/admin/github/import" && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      const repos = Array.isArray(payload.repos) ? payload.repos : payload.repo ? [payload.repo] : [];
      if (!repos.length) return jsonAdmin({ error: "no repos to import" }, 400);
      const results = [];
      for (const repo of repos.slice(0, 20)) {
        try {
          const { item, deduped: wasDup } = await importGithubRepo(env, repo);
          results.push({ ok: true, item, deduped: wasDup });
        } catch (error) {
          results.push({ ok: false, error: error?.message || "import failed", repo: repo?.name || "" });
        }
      }
      return jsonAdmin({ results });
    }

    // ---- Workers AI short review (admin-triggered, saved to D1; visitors read D1 only) ----
    if (path === "/api/admin/ai-review" && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      const id = cleanOneLine(payload.id || payload.itemId, 120);
      if (!id) return jsonAdmin({ error: "content id is required" }, 400);
      const overwrite = Boolean(payload.overwrite);
      try {
        return jsonAdmin({ item: await generateAiReview(env, id, payload.repo || {}, overwrite) });
      } catch (error) {
        // AI failure must never block saving the project itself.
        return jsonAdmin({ error: error?.message || "ai review failed" }, 502);
      }
    }

    if (path.startsWith("/api/admin/comments/")) {
      const id = decodeURIComponent(path.slice("/api/admin/comments/".length));
      if (!id) return jsonAdmin({ error: "comment id is required" }, 400);

      if (request.method === "PATCH") {
        const payload = await request.json().catch(() => ({}));
        const status = cleanOneLine(payload.status, 20);
        if (!["approved", "pending", "rejected"].includes(status)) {
          return jsonAdmin({ error: "invalid comment status" }, 400);
        }
        const comment = await updateCommentStatus(env, id, status);
        if (status !== "pending") await refreshApprovedCommentsCache(env);
        return jsonAdmin({ comment });
      }

      if (request.method === "DELETE") {
        await deleteComment(env, id);
        await refreshApprovedCommentsCache(env);
        return jsonAdmin({ ok: true });
      }
    }

    return jsonAdmin({ error: "method not allowed" }, 405);
  } catch (error) {
    return serviceErrorResponse(error, true);
  }
}

async function adminAiChatRateLimit(request, env) {
  const token = cookieValue(request.headers.get("Cookie"), ADMIN_COOKIE_NAME);
  const id = token ? (await sha256Hex(token)).slice(0, 32) : clientIp(request);
  return rateLimitCheck(env, "aichat", id, AI_CHAT_RATE_LIMITS);
}

async function adminLogin(request, env) {
  const adminPassword = await loadAdminPassword(env);
  if (!adminPassword) {
    return jsonAdmin({
      error: "Admin password is not configured for this deployment. Set ADMIN_PASSWORD on the Worker or Pages project that serves this custom domain.",
    }, 503);
  }

  const ip = clientIp(request);
  const failure = await loginFailureState(env, ip);
  if (failure.count >= LOGIN_FAILURE_LIMIT.max) {
    return rateLimitedResponse(failure.retryAfter, true);
  }

  const payload = await request.json().catch(() => ({}));
  const password = String(payload.password || "");
  const ok = await verifyPassword(password, adminPassword);
  if (!ok) {
    await incrementLoginFailure(env, ip);
    return jsonAdmin({ error: "invalid password" }, 401);
  }

  await clearLoginFailures(env, ip, failure.count);
  const token = await createAdminToken(adminPassword);
  return jsonAdmin({ ok: true }, 200, {
    "set-cookie": `${ADMIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ADMIN_SESSION_SECONDS}`,
  });
}

function loginFailureKey(ipHash, bucket) {
  return `${RATE_LIMIT_PREFIX}:login-fail:${ipHash}:${bucket}`;
}

async function hashedIp(ip) {
  return (await sha256Hex(cleanOneLine(ip, 128) || "unknown")).slice(0, 32);
}

async function loginFailureState(env, ip) {
  if (!env.COMMENTS_KV) return { count: 0, retryAfter: 0 };
  const windowMs = LOGIN_FAILURE_LIMIT.windowSeconds * 1000;
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const count = Number.parseInt(await env.COMMENTS_KV.get(loginFailureKey(await hashedIp(ip), bucket)).catch(() => "0") || "0", 10) || 0;
  const retryAfter = Math.max(1, LOGIN_FAILURE_LIMIT.windowSeconds - Math.floor((now % windowMs) / 1000));
  return { count, retryAfter };
}

async function incrementLoginFailure(env, ip) {
  if (!env.COMMENTS_KV) return;
  const windowMs = LOGIN_FAILURE_LIMIT.windowSeconds * 1000;
  const bucket = Math.floor(Date.now() / windowMs);
  const key = loginFailureKey(await hashedIp(ip), bucket);
  const count = Number.parseInt(await env.COMMENTS_KV.get(key).catch(() => "0") || "0", 10) || 0;
  await env.COMMENTS_KV.put(key, String(count + 1), { expirationTtl: LOGIN_FAILURE_LIMIT.windowSeconds * 2 }).catch(() => {});
}

async function clearLoginFailures(env, ip, knownCount = -1) {
  if (!env.COMMENTS_KV) return;
  // A DELETE on an absent key still counts against the 1,000/day KV delete
  // budget, so skip it when the pre-login state already shows zero failures.
  if (knownCount === 0) return;
  const windowMs = LOGIN_FAILURE_LIMIT.windowSeconds * 1000;
  const bucket = Math.floor(Date.now() / windowMs);
  await env.COMMENTS_KV.delete(loginFailureKey(await hashedIp(ip), bucket)).catch(() => {});
}

async function ensureSchema(env) {
  if (!env.COMMENTS_DB || memory.schemaReady) return;
  // Production schema is managed by migrations/0001_comments_d1.sql,
  // migrations/0002_site_events.sql and migrations/0003_site_profiles.sql.
  // The DDL bootstrap below only runs for local preview where
  // RUNTIME_SCHEMA_BOOTSTRAP is set.
  if (env.RUNTIME_SCHEMA_BOOTSTRAP !== "1") return;
  await env.COMMENTS_DB.prepare(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      message TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT 'unknown',
      ip_location TEXT NOT NULL DEFAULT 'Unknown location',
      status TEXT NOT NULL DEFAULT 'pending',
      moderation_model TEXT,
      moderation_result TEXT,
      moderation_categories TEXT,
      moderation_reason TEXT,
      moderation_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT
    )
  `).run();
  await env.COMMENTS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_comments_status_created ON comments (status, created_at DESC)").run();
  await env.COMMENTS_DB.prepare(`
    CREATE TABLE IF NOT EXISTS site_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await env.COMMENTS_DB.prepare(`
    CREATE TABLE IF NOT EXISTS site_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      path TEXT NOT NULL,
      page TEXT,
      lang TEXT,
      title TEXT,
      referrer TEXT,
      ip TEXT NOT NULL DEFAULT 'unknown',
      ip_location TEXT NOT NULL DEFAULT 'Unknown location',
      user_agent TEXT,
      created_at TEXT NOT NULL
    )
  `).run();
  await env.COMMENTS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_site_events_type_created ON site_events (type, created_at DESC)").run();
  await env.COMMENTS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_site_events_path_created ON site_events (path, created_at DESC)").run();
  await env.COMMENTS_DB.prepare(`
    CREATE TABLE IF NOT EXISTS site_profiles (
      id TEXT PRIMARY KEY,
      hostname TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      profile_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    )
  `).run();
  await env.COMMENTS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_site_profiles_hostname ON site_profiles (hostname)").run();
  await env.COMMENTS_DB.prepare(`
    CREATE TABLE IF NOT EXISTS content_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '{}',
      subtitle TEXT NOT NULL DEFAULT '{}',
      summary TEXT NOT NULL DEFAULT '{}',
      cover TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await env.COMMENTS_DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_content_items_type_slug ON content_items (type, slug)").run();
  await env.COMMENTS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_content_items_type_enabled ON content_items (type, enabled, sort_order)").run();
  await env.COMMENTS_DB.prepare(`
    CREATE TABLE IF NOT EXISTS contact_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `).run();
  memory.schemaReady = true;
}

async function listApprovedComments(env, limit) {
  const now = Date.now();
  if (memory.comments && memory.commentsExpiresAt > now) {
    return memory.comments.slice(0, limit).map(publicComment);
  }

  const config = await loadSiteConfig(env);
  if (env.COMMENTS_KV) {
    const cached = await env.COMMENTS_KV.get(APPROVED_COMMENTS_CACHE_KEY, "json").catch(() => null);
    if (Array.isArray(cached)) {
      setMemoryComments(cached, config);
      return cached.slice(0, limit).map(publicComment);
    }
  }

  const comments = env.COMMENTS_DB
    ? await listD1Comments(env, MAX_STORED_COMMENTS, "approved")
    : await listLegacyKvComments(env, MAX_STORED_COMMENTS);
  await writeApprovedCommentsCache(env, comments, config);
  return comments.slice(0, limit).map(publicComment);
}

async function listAdminComments(env, limit, status) {
  if (env.COMMENTS_DB) {
    return (await listD1Comments(env, limit, status)).map(adminComment);
  }
  return (await listLegacyKvComments(env, limit)).map((comment) => adminComment({ ...comment, status: "approved" }));
}

async function listD1Comments(env, limit, status = "approved") {
  await ensureSchema(env);
  const capped = commentLimit(limit);
  const columns = `
    id, name, message, ip, ip_location, status, moderation_model, moderation_result,
    moderation_categories, moderation_reason, moderation_error, created_at, updated_at, reviewed_at
  `;
  const query = status && status !== "all"
    ? env.COMMENTS_DB.prepare(`SELECT ${columns} FROM comments WHERE status = ? ORDER BY created_at DESC LIMIT ?`).bind(status, capped)
    : env.COMMENTS_DB.prepare(`SELECT ${columns} FROM comments ORDER BY created_at DESC LIMIT ?`).bind(capped);
  const result = await query.all();
  return (result.results || []).map(commentFromRow);
}

async function saveComment(env, comment) {
  if (env.COMMENTS_DB) {
    await ensureSchema(env);
    await env.COMMENTS_DB.prepare(`
      INSERT INTO comments (
        id, name, message, ip, ip_location, status, moderation_model, moderation_result,
        moderation_categories, moderation_reason, moderation_error, created_at, updated_at, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      comment.id,
      comment.name,
      comment.message,
      comment.ip,
      comment.ipLocation,
      comment.status,
      comment.moderationModel || "",
      comment.moderationResult || "",
      comment.moderationCategories || "",
      comment.moderationReason || "",
      comment.moderationError || "",
      comment.createdAt,
      comment.updatedAt,
      comment.reviewedAt || ""
    ).run();
    return;
  }

  if (!env.COMMENTS_KV) throw new Error("comment storage is not configured");
  if (comment.status !== "approved") return;
  const comments = await listLegacyKvComments(env, MAX_STORED_COMMENTS);
  const next = [comment, ...comments.filter((item) => item.id !== comment.id)].slice(0, MAX_STORED_COMMENTS);
  await env.COMMENTS_KV.put(LEGACY_COMMENT_INDEX_KEY, JSON.stringify(next));
}

async function updateCommentStatus(env, id, status) {
  if (!env.COMMENTS_DB) throw new Error("D1 comment storage is not configured");
  await ensureSchema(env);
  const now = new Date().toISOString();
  const reviewedAt = status === "approved" || status === "rejected" ? now : "";
  await env.COMMENTS_DB.prepare("UPDATE comments SET status = ?, updated_at = ?, reviewed_at = ? WHERE id = ?")
    .bind(status, now, reviewedAt, id)
    .run();
  const comment = await env.COMMENTS_DB.prepare(`
    SELECT id, name, message, ip, ip_location, status, moderation_model, moderation_result,
      moderation_categories, moderation_reason, moderation_error, created_at, updated_at, reviewed_at
    FROM comments WHERE id = ?
  `).bind(id).first();
  if (!comment) throw new Error("comment not found");
  return adminComment(commentFromRow(comment));
}

async function deleteComment(env, id) {
  if (env.COMMENTS_DB) {
    await ensureSchema(env);
    await env.COMMENTS_DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
    return;
  }

  if (!env.COMMENTS_KV) throw new Error("comment deletion is not configured");
  const comments = await listLegacyKvComments(env, MAX_STORED_COMMENTS);
  const next = comments.filter((item) => String(item.id || "") !== String(id));
  await env.COMMENTS_KV.put(LEGACY_COMMENT_INDEX_KEY, JSON.stringify(next));
}

async function migrateLegacyComments(env) {
  if (!env.COMMENTS_DB) throw new Error("D1 comment storage is not configured");
  if (!env.COMMENTS_KV) throw new Error("legacy KV storage is not configured");
  await ensureSchema(env);
  const legacy = await listLegacyKvComments(env, MAX_STORED_COMMENTS);
  let imported = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const source of legacy) {
    const id = cleanOneLine(source.id, 80) || crypto.randomUUID();
    const result = await env.COMMENTS_DB.prepare(`
      INSERT OR IGNORE INTO comments (
        id, name, message, ip, ip_location, status, moderation_model, moderation_result,
        moderation_categories, moderation_reason, moderation_error, created_at, updated_at, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, 'approved', 'legacy-kv', ?, '', 'Imported from legacy KV comments:index', '', ?, ?, ?)
    `).bind(
      id,
      cleanOneLine(source.name, 32) || "Anonymous",
      cleanMessage(source.message, 500),
      cleanOneLine(source.ip, 64) || "unknown",
      cleanOneLine(source.ipLocation || source.location, 120) || "Unknown location",
      JSON.stringify({ source: LEGACY_COMMENT_INDEX_KEY }),
      cleanOneLine(source.createdAt, 40) || now,
      now,
      now
    ).run();
    if (result.meta?.changes) imported += 1;
    else skipped += 1;
  }

  await refreshApprovedCommentsCache(env);
  return { imported, skipped, total: legacy.length };
}

async function listLegacyKvComments(env, limit) {
  const comments = env.COMMENTS_KV ? await env.COMMENTS_KV.get(LEGACY_COMMENT_INDEX_KEY, "json") : null;
  return Array.isArray(comments) ? comments.slice(0, commentLimit(limit)) : [];
}

async function saveEvent(env, event) {
  await ensureSchema(env);
  await env.COMMENTS_DB.prepare(`
    INSERT INTO site_events (
      id, type, path, page, lang, title, referrer, ip, ip_location, user_agent, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    event.type || "page_view",
    event.path || "/",
    event.page || "",
    event.lang || "",
    event.title || "",
    event.referrer || "",
    event.ip || "unknown",
    event.ipLocation || "Unknown location",
    event.userAgent || "",
    new Date().toISOString()
  ).run();
}

// --- Telegram comment notifications (owner-only, outgoing only) ---
// Secrets live in Pages/Worker bindings (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
// and are never logged, returned, or sent to the browser.

export function buildTelegramMessage(comment, meta = {}) {
  const lines = [
    "💬 New comment on about.shuangyue.space",
    "",
    `Name: ${cleanOneLine(comment?.name, 32) || "Anonymous"}`,
    `Page: ${cleanPath(meta.page || "/")}`,
    `Language: ${cleanOneLine(meta.lang, 12) || "zh"}`,
    `Status: ${cleanOneLine(comment?.status, 20) || "pending"}`,
    "",
    "Message:",
    cleanMessage(comment?.message, 400),
    "",
    "Time:",
    formatCst(comment?.createdAt ? new Date(comment.createdAt) : new Date()),
    "",
    "Comment ID:",
    cleanOneLine(comment?.id, 80),
  ];
  return lines.join("\n");
}

// Never include raw IPs, cookies, auth tokens, Turnstile tokens, or request
// headers in the notification. The comment row already has its own UUID, so
// each successful insert notifies exactly once with no extra dedup storage.
export async function sendTelegramNotification(env, text, fetchImpl = fetch) {
  const token = await loadSecret(env, "TELEGRAM_BOT_TOKEN");
  const chatId = await loadSecret(env, "TELEGRAM_CHAT_ID");
  if (!token || !chatId) return { ok: false, skipped: true, reason: "telegram is not configured" };

  const body = cleanMessage(text, 3000);
  if (!body) return { ok: false, skipped: true, reason: "empty message" };

  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: body, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, error: error?.message || "telegram request failed" };
  }
  if (!response.ok) {
    return { ok: false, error: `telegram responded HTTP ${response.status}` };
  }
  return { ok: true };
}

export function formatCst(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())} +08:00`;
}

async function adminAiChat(env, message) {
  if (!env.AI?.run) {
    return {
      reply: "Workers AI 绑定（AI）未配置，无法生成回复。请在 Cloudflare Pages → Settings → Functions → Workers AI Bindings 中添加。",
      contextMeta: null,
    };
  }
  if (!env.COMMENTS_DB) {
    return {
      reply: "D1 数据库绑定（COMMENTS_DB）未配置，无法查询统计数据。请在 Cloudflare Pages → Settings → Functions → D1 Database Bindings 中配置。",
      contextMeta: null,
    };
  }

  const config = await loadSiteConfig(env);
  const model = cleanOneLine(config.aiChatModel, 120) || DEFAULT_CHAT_MODEL;

  let context;
  try {
    context = await adminAiContext(env, config);
  } catch (error) {
    return {
      reply: `查询 D1 数据失败：${error?.message || "数据库暂时不可用，请稍后重试。"}`,
      contextMeta: null,
    };
  }

  const prompt = [
    "You are the private admin assistant for this personal site.",
    "Answer in Chinese unless the admin asks for another language.",
    "Use only the provided D1 site data. If the data is missing, say so directly.",
    "You can summarize visits, top pages, recent events, comment moderation status, and site configuration.",
    "Do not claim you changed data. This chat is read-only.",
    "",
    "D1 context JSON:",
    JSON.stringify(context),
    "",
    `Admin question: ${message}`,
  ].join("\n");

  const meta = {
    generatedAt: context.generatedAt,
    windows: ["过去 24 小时", "过去 7 天", "过去 30 天"],
  };
  const result = await raceWithTimeout(runTextModel(env, model, prompt), AI_CHAT_TIMEOUT_MS);
  if (!result) {
    return {
      reply: `AI 推理超时（超过 ${Math.round(AI_CHAT_TIMEOUT_MS / 1000)} 秒），本次没有生成回复。请稍后重试；若持续超时，可在「系统配置」里把 AI 对话模型换成响应更快的模型。`,
      contextMeta: meta,
    };
  }
  return {
    reply: extractModelText(result) || "没有得到可读的 AI 回复。",
    contextMeta: meta,
  };
}

function raceWithTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function adminAiContext(env, config) {
  await ensureSchema(env);
  const [commentCounts, eventTotals, topPaths, recentEvents, recentComments] = await Promise.all([
    queryCommentCounts(env),
    queryEventTotals(env),
    queryTopPaths(env),
    queryRecentEvents(env),
    queryRecentComments(env),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    runtimeConfig: summarizeRuntimeConfig(config),
    commentCounts,
    eventTotals,
    topPaths,
    recentEvents,
    recentComments,
  };
}

function summarizeRuntimeConfig(config) {
  return {
    commentsEnabled: config.commentsEnabled !== false,
    moderationEnabled: config.moderationEnabled !== false,
    migrationEnabled: config.migrationEnabled !== false,
    aiModel: config.aiModel || DEFAULT_MODERATION_MODEL,
    aiChatModel: config.aiChatModel || DEFAULT_CHAT_MODEL,
    approvedCacheTtlSeconds: config.approvedCacheTtlSeconds,
    memoryCacheTtlSeconds: config.memoryCacheTtlSeconds,
    turnstileSiteKeyConfigured: Boolean(config.turnstileSiteKey),
    updatedAt: config.updatedAt || "",
  };
}

async function queryCommentCounts(env) {
  const rows = await env.COMMENTS_DB.prepare(`
    SELECT status, COUNT(*) AS count FROM comments GROUP BY status
  `).all();
  return Object.fromEntries((rows.results || []).map((row) => [row.status || "unknown", row.count || 0]));
}

async function queryEventTotals(env) {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const row = await env.COMMENTS_DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last24h,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last7d,
      COUNT(DISTINCT ip) AS uniqueIps
    FROM site_events
    WHERE type = 'page_view'
  `).bind(last24h, last7d).first();
  return {
    total: row?.total || 0,
    last24h: row?.last24h || 0,
    last7d: row?.last7d || 0,
    uniqueIps: row?.uniqueIps || 0,
  };
}

async function queryTopPaths(env) {
  const last30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await env.COMMENTS_DB.prepare(`
    SELECT path, COUNT(*) AS count
    FROM site_events
    WHERE type = 'page_view' AND created_at >= ?
    GROUP BY path
    ORDER BY count DESC
    LIMIT 10
  `).bind(last30d).all();
  return rows.results || [];
}

async function queryRecentEvents(env) {
  const rows = await env.COMMENTS_DB.prepare(`
    SELECT type, path, page, lang, ip_location, created_at
    FROM site_events
    ORDER BY created_at DESC
    LIMIT 20
  `).all();
  return rows.results || [];
}

async function queryRecentComments(env) {
  const rows = await env.COMMENTS_DB.prepare(`
    SELECT id, name, message, status, moderation_model, moderation_categories, moderation_reason, created_at
    FROM comments
    ORDER BY created_at DESC
    LIMIT 20
  `).all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    message: cleanMessage(row.message, 120),
    status: row.status,
    moderationModel: row.moderation_model,
    moderationCategories: row.moderation_categories,
    moderationReason: row.moderation_reason,
    createdAt: row.created_at,
  }));
}

async function refreshApprovedCommentsCache(env) {
  memory.comments = null;
  memory.commentsExpiresAt = 0;
  const config = await loadSiteConfig(env, { force: true });
  const comments = env.COMMENTS_DB ? await listD1Comments(env, MAX_STORED_COMMENTS, "approved") : await listLegacyKvComments(env, MAX_STORED_COMMENTS);
  await writeApprovedCommentsCache(env, comments, config);
}

async function writeApprovedCommentsCache(env, comments, config) {
  const publicList = comments.map(publicComment);
  setMemoryComments(publicList, config);
  if (!env.COMMENTS_KV) return;
  const ttl = Math.max(60, Number.parseInt(config.approvedCacheTtlSeconds || DEFAULT_CACHE_TTL_SECONDS, 10) || DEFAULT_CACHE_TTL_SECONDS);
  await env.COMMENTS_KV.put(APPROVED_COMMENTS_CACHE_KEY, JSON.stringify(publicList), { expirationTtl: ttl });
}

function setMemoryComments(comments, config) {
  const ttl = Number.parseInt(config.memoryCacheTtlSeconds || DEFAULT_MEMORY_TTL_SECONDS, 10) || DEFAULT_MEMORY_TTL_SECONDS;
  memory.comments = comments;
  memory.commentsExpiresAt = Date.now() + Math.max(1, Math.min(ttl, 300)) * 1000;
}

async function loadSiteConfig(env, options = {}) {
  const now = Date.now();
  if (!options.force && memory.config && memory.configExpiresAt > now) return memory.config;

  let stored = null;
  if (env.COMMENTS_DB) {
    await ensureSchema(env);
    const row = await env.COMMENTS_DB.prepare("SELECT value FROM site_config WHERE key = ?").bind(SITE_CONFIG_KEY).first();
    if (row?.value) stored = JSON.parse(row.value);
  } else if (env.COMMENTS_KV) {
    stored = await env.COMMENTS_KV.get(SITE_SETTINGS_KEY, "json");
  }

  const config = sanitizeSiteConfig(stored || {}, DEFAULT_SITE_CONFIG, env);
  memory.config = config;
  memory.configExpiresAt = now + Math.max(1, Math.min(config.memoryCacheTtlSeconds, 300)) * 1000;
  return config;
}

async function saveSiteConfig(env, config) {
  const next = sanitizeSiteConfig(config, DEFAULT_SITE_CONFIG, env);
  if (env.COMMENTS_DB) {
    await ensureSchema(env);
    await env.COMMENTS_DB.prepare(`
      INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(SITE_CONFIG_KEY, JSON.stringify(next), next.updatedAt || new Date().toISOString()).run();
  }

  // KV is no longer a site_config store: with D1 present it only holds the
  // approved comments cache (comments:approved:v1) and short-lived rate-limit
  // counters. Legacy KV-only deployments keep reading SITE_SETTINGS_KEY above.
  memory.config = next;
  memory.configExpiresAt = Date.now() + Math.max(1, Math.min(next.memoryCacheTtlSeconds, 300)) * 1000;
}

function publicSiteSettings(settings) {
  return {
    commentsEnabled: settings.commentsEnabled !== false,
    moderationEnabled: settings.moderationEnabled !== false,
    turnstileSiteKey: cleanOneLine(settings.turnstileSiteKey, 256),
    title: settings.title,
    subtitle: settings.subtitle,
    documentTitle: settings.documentTitle,
    notice: settings.notice,
    updatedAt: settings.updatedAt || "",
  };
}

// --- Site profiles: D1 -> KV (60s) -> memory. Admin saves invalidate. ---
async function loadSiteProfile(env, hostname) {
  const host = normalizeHostname(hostname) || "about.shuangyue.space";
  const now = Date.now();
  const mem = memory.profiles.get(host);
  if (mem && mem.expiresAt > now) return mem.profile;
  if (env?.COMMENTS_KV) {
    try {
      const cached = await env.COMMENTS_KV.get(profileCacheKey(host), "json");
      if (cached && typeof cached === "object") {
        const profile = sanitizeProfile(cached, host);
        memory.profiles.set(host, { profile, expiresAt: now + PROFILE_CACHE_TTL_SECONDS * 1000 });
        return profile;
      }
    } catch { /* fall through to D1/defaults */ }
  }
  if (env?.COMMENTS_DB) {
    try {
      await ensureSchema(env);
      const row = await env.COMMENTS_DB.prepare("SELECT profile_json FROM site_profiles WHERE hostname = ?").bind(host).first();
      if (row?.profile_json) {
        const profile = sanitizeProfile({ ...JSON.parse(row.profile_json), hostname: host }, host);
        memory.profiles.set(host, { profile, expiresAt: now + PROFILE_CACHE_TTL_SECONDS * 1000 });
        if (env?.COMMENTS_KV) {
          // Best-effort cross-isolate cache; hot path never waits on failures.
          env.COMMENTS_KV.put(profileCacheKey(host), JSON.stringify(profile), { expirationTtl: PROFILE_CACHE_TTL_SECONDS }).catch(() => {});
        }
        return profile;
      }
    } catch { /* fall through to built-in defaults */ }
  }
  const fallback = sanitizeProfile(defaultProfileFor(host), host);
  memory.profiles.set(host, { profile: fallback, expiresAt: now + Math.min(PROFILE_CACHE_TTL_SECONDS, 15) * 1000 });
  return fallback;
}

async function listSiteProfiles(env) {
  if (!env?.COMMENTS_DB) return [defaultProfileFor("about.shuangyue.space"), defaultProfileFor("wx.shuangyue.space"), defaultProfileFor("qq.shuangyue.space"), defaultProfileFor("github.shuangyue.space"), defaultProfileFor("travel.shuangyue.space")];
  await ensureSchema(env);
  const rows = await env.COMMENTS_DB.prepare("SELECT hostname, profile_json FROM site_profiles ORDER BY hostname ASC").all();
  const list = (rows.results || []).map((row) => {
    try {
      return sanitizeProfile({ ...JSON.parse(row.profile_json || "{}"), hostname: row.hostname }, row.hostname);
    } catch {
      return sanitizeProfile(defaultProfileFor(row.hostname), row.hostname);
    }
  });
  // Always surface the five well-known hostnames so the admin UI can create them in one click.
  for (const host of ["about.shuangyue.space", "wx.shuangyue.space", "qq.shuangyue.space", "github.shuangyue.space", "travel.shuangyue.space"]) {
    if (!list.some((p) => p.hostname === host)) list.push(sanitizeProfile(defaultProfileFor(host), host));
  }
  return list.sort((a, b) => a.hostname.localeCompare(b.hostname));
}

async function saveSiteProfile(env, input) {
  const profile = sanitizeProfile(input, input?.hostname);
  profile.updatedAt = new Date().toISOString();
  if (!env?.COMMENTS_DB) throw new Error("D1 profile storage is not configured");
  await ensureSchema(env);
  await env.COMMENTS_DB.prepare(`
    INSERT INTO site_profiles (id, hostname, enabled, profile_json, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(hostname) DO UPDATE SET enabled = excluded.enabled, profile_json = excluded.profile_json, updated_at = excluded.updated_at
  `).bind(profile.hostname, profile.hostname, profile.enabled ? 1 : 0, JSON.stringify(profile), profile.updatedAt).run();
  memory.profiles.delete(profile.hostname);
  if (env?.COMMENTS_KV) {
    await env.COMMENTS_KV.delete(profileCacheKey(profile.hostname)).catch(() => {});
    await env.COMMENTS_KV.put(profileCacheKey(profile.hostname), JSON.stringify(profile), { expirationTtl: PROFILE_CACHE_TTL_SECONDS }).catch(() => {});
  }
  return profile;
}

async function deleteSiteProfile(env, hostname) {
  const host = normalizeHostname(hostname);
  if (!host) throw new Error("hostname is required");
  if (env?.COMMENTS_DB) {
    await ensureSchema(env);
    await env.COMMENTS_DB.prepare("DELETE FROM site_profiles WHERE hostname = ?").bind(host).run();
  }
  memory.profiles.delete(host);
  if (env?.COMMENTS_KV) await env.COMMENTS_KV.delete(profileCacheKey(host)).catch(() => {});
  return { ok: true };
}

async function invalidateProfileCache(env, hostname) {
  if (hostname) memory.profiles.delete(normalizeHostname(hostname));
  else memory.profiles.clear();
  if (hostname && env?.COMMENTS_KV) await env.COMMENTS_KV.delete(profileCacheKey(hostname)).catch(() => {});
}

// --- Contact catalog: D1 source, DEFAULT_CONTACTS fallback. ---
async function loadAllContacts(env, options = {}) {
  const now = Date.now();
  if (!options.includeDisabled && memory.contacts && memory.contactsExpiresAt > now) return memory.contacts;
  if (env?.COMMENTS_DB) {
    try {
      await ensureSchema(env);
      const rows = await env.COMMENTS_DB.prepare("SELECT type, label, value, url, enabled, sort_order FROM contact_items ORDER BY sort_order ASC").all();
      const stored = (rows.results || []).map((row) => ({
        type: String(row.type || ""),
        label: String(row.label || ""),
        value: String(row.value || ""),
        url: String(row.url || ""),
        enabled: Number(row.enabled) !== 0,
        sortOrder: Number(row.sort_order) || 0,
      })).filter((c) => c.type);
      if (stored.length) {
        if (!options.includeDisabled) {
          memory.contacts = stored;
          memory.contactsExpiresAt = now + PROFILE_CACHE_TTL_SECONDS * 1000;
        }
        return options.includeDisabled ? stored : stored;
      }
    } catch { /* fall through to defaults */ }
  }
  const all = DEFAULT_CONTACTS.map((c) => ({ ...c }));
  if (!options.includeDisabled) {
    memory.contacts = all;
    memory.contactsExpiresAt = now + Math.min(PROFILE_CACHE_TTL_SECONDS, 15) * 1000;
  }
  return all;
}

async function saveAllContacts(env, contacts) {
  const cleaned = (Array.isArray(contacts) ? contacts : []).map((c, i) => ({
    id: String(c.type || "").toLowerCase(),
    type: String(c.type || "").toLowerCase(),
    label: cleanOneLine(c.label, 40),
    value: cleanOneLine(c.value, 300),
    url: cleanOneLine(c.url, 500),
    enabled: c.enabled !== false ? 1 : 0,
    sortOrder: Number.isFinite(Number(c.sortOrder)) ? Number(c.sortOrder) : i * 10,
    updatedAt: new Date().toISOString(),
  })).filter((c) => c.type && CONTACT_TYPES.includes(c.type));
  if (!env?.COMMENTS_DB) throw new Error("contact storage is not configured");
  await ensureSchema(env);
  for (const c of cleaned) {
    await env.COMMENTS_DB.prepare(`
      INSERT INTO contact_items (id, type, label, value, url, enabled, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(type) DO UPDATE SET label = excluded.label, value = excluded.value, url = excluded.url, enabled = excluded.enabled, sort_order = excluded.sort_order, updated_at = excluded.updated_at
    `).bind(c.id, c.type, c.label, c.value, c.url, c.enabled, c.sortOrder, c.updatedAt).run();
  }
  memory.contacts = null;
  memory.contactsExpiresAt = 0;
  return loadAllContacts(env, { includeDisabled: true });
}

// --- Content items (anime / game / github share one table) ---
function parseTri(value, fallback = {}) {
  if (value && typeof value === "object") return { zh: String(value.zh || ""), ja: String(value.ja || value.zh || ""), en: String(value.en || value.zh || "") };
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (parsed && typeof parsed === "object") return { zh: String(parsed.zh || ""), ja: String(parsed.ja || parsed.zh || ""), en: String(parsed.en || parsed.zh || "") };
  } catch { /* keep fallback */ }
  return { zh: String(fallback.zh || ""), ja: String(fallback.ja || fallback.zh || ""), en: String(fallback.en || fallback.zh || "") };
}

function publicContentItem(row) {
  const title = parseTri(row.title);
  const subtitle = parseTri(row.subtitle);
  const summary = parseTri(row.summary);
  let metadata = {};
  try { metadata = JSON.parse(row.metadata_json || "{}"); } catch { metadata = {}; }
  const pick = (tri) => tri.zh || tri.ja || tri.en || "";
  return {
    id: String(row.id || ""),
    type: String(row.type || ""),
    slug: String(row.slug || ""),
    title: { zh: title.zh || pick(title), ja: title.ja || title.zh, en: title.en || title.zh },
    subtitle: { zh: subtitle.zh, ja: subtitle.ja || subtitle.zh, en: subtitle.en || subtitle.zh },
    summary: { zh: summary.zh, ja: summary.ja || summary.zh, en: summary.en || summary.zh },
    cover: String(row.cover || ""),
    url: String(row.url || ""),
    metadata,
    enabled: Number(row.enabled) !== 0,
    sortOrder: Number(row.sort_order) || 0,
    updatedAt: String(row.updated_at || ""),
  };
}

function adminContentItem(row) {
  return { ...publicContentItem(row), createdAt: String(row.created_at || "") };
}

async function listContentItems(env, type = "all", publicOnly = false) {
  if (!env?.COMMENTS_DB) return [];
  await ensureSchema(env);
  const t = String(type || "all").toLowerCase();
  let rows;
  if (t && t !== "all") {
    rows = publicOnly
      ? await env.COMMENTS_DB.prepare("SELECT * FROM content_items WHERE type = ? AND enabled = 1 ORDER BY sort_order ASC, updated_at DESC LIMIT 200").bind(t).all()
      : await env.COMMENTS_DB.prepare("SELECT * FROM content_items WHERE type = ? ORDER BY sort_order ASC, updated_at DESC LIMIT 200").bind(t).all();
  } else {
    rows = publicOnly
      ? await env.COMMENTS_DB.prepare("SELECT * FROM content_items WHERE enabled = 1 ORDER BY type ASC, sort_order ASC, updated_at DESC LIMIT 200").all()
      : await env.COMMENTS_DB.prepare("SELECT * FROM content_items ORDER BY type ASC, sort_order ASC, updated_at DESC LIMIT 200").all();
  }
  return rows.results || [];
}

async function saveContentItem(env, input) {
  const type = String(input?.type || "").toLowerCase();
  if (![...CONTENT_TYPES, "project", "anime", "game", "github"].includes(type)) throw new Error("invalid content type");
  const slug = cleanOneLine(input?.slug, 120).toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `item-${Date.now()}`;
  const now = new Date().toISOString();
  const id = cleanOneLine(input?.id, 80) || `${type}:${slug}`;
  const tri = (v) => JSON.stringify({
    zh: cleanMessage(v?.zh ?? v, 2000),
    ja: cleanMessage(v?.ja ?? v?.zh ?? v, 2000),
    en: cleanMessage(v?.en ?? v?.zh ?? v, 2000),
  });
  if (!env?.COMMENTS_DB) throw new Error("content storage is not configured");
  await ensureSchema(env);
  const existing = await env.COMMENTS_DB.prepare("SELECT * FROM content_items WHERE id = ?").bind(id).first().catch(() => null);
  let prevMeta = {};
  try { prevMeta = JSON.parse(existing?.metadata_json || "{}"); } catch { prevMeta = {}; }
  const incomingMeta = typeof input?.metadata === "object" && input.metadata ? input.metadata : safeJsonParse(input?.metadata_json, {});
  // Manual saves mark manualEdited so later AI reviews never clobber them
  // unless the admin explicitly clicks “重新生成并覆盖”.
  const hasManualSummary = Boolean(cleanMessage(input?.summary?.zh ?? input?.summary, 2000));
  const metadata = { ...prevMeta, ...incomingMeta };
  if (hasManualSummary) metadata.manualEdited = true;
  metadata.manualEdited = Boolean(metadata.manualEdited);
  // Manual projects keep source_type=manual so future GitHub refreshes by
  // sourceId can never match them; imported rows carry sourceType=github.
  if (!metadata.sourceType) metadata.sourceType = prevMeta.sourceType || "manual";
  await env.COMMENTS_DB.prepare(`
    INSERT INTO content_items (id, type, slug, title, subtitle, summary, cover, url, metadata_json, enabled, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET type = excluded.type, slug = excluded.slug, title = excluded.title, subtitle = excluded.subtitle, summary = excluded.summary, cover = excluded.cover, url = excluded.url, metadata_json = excluded.metadata_json, enabled = excluded.enabled, sort_order = excluded.sort_order, updated_at = excluded.updated_at
  `).bind(
    id, type, slug,
    typeof input?.title === "string" ? JSON.stringify({ zh: input.title, ja: input.title, en: input.title }) : tri(input?.title),
    typeof input?.subtitle === "string" ? JSON.stringify({ zh: input.subtitle, ja: input.subtitle, en: input.subtitle }) : tri(input?.subtitle),
    typeof input?.summary === "string" ? JSON.stringify({ zh: input.summary, ja: input.summary, en: input.summary }) : tri(input?.summary),
    cleanOneLine(input?.cover, 500), cleanOneLine(input?.url, 500), JSON.stringify(metadata).slice(0, 8000),
    input?.enabled !== false ? 1 : 0, Number.isFinite(Number(input?.sortOrder)) ? Number(input.sortOrder) : 0,
    existing?.created_at || now, now
  ).run();
  const saved = await env.COMMENTS_DB.prepare("SELECT * FROM content_items WHERE id = ?").bind(id).first();
  return adminContentItem(saved);
}

// Default delete is a soft hide (enabled=0) so mistakes are recoverable;
// permanent physical DELETE only runs with ?permanent=1. Public list/detail
// queries already filter enabled=1, so hidden rows vanish from the frontend
// while remaining restorable from the admin list.
async function deleteContentItem(env, id) {
  if (!id) throw new Error("content id is required");
  if (!env?.COMMENTS_DB) throw new Error("content storage is not configured");
  await ensureSchema(env);
  await env.COMMENTS_DB.prepare("UPDATE content_items SET enabled = 0, updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), String(id)).run();
  return { ok: true, soft: true };
}

async function hardDeleteContentItem(env, id) {
  if (!id) throw new Error("content id is required");
  if (!env?.COMMENTS_DB) throw new Error("content storage is not configured");
  await ensureSchema(env);
  await env.COMMENTS_DB.prepare("DELETE FROM content_items WHERE id = ?").bind(String(id)).run();
  return { ok: true, soft: false };
}

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// Derives a stable "owner/repo" id from a scan candidate (pure, unit-tested).
export function githubSourceId(repo = {}) {
  const m = String(repo.html_url || repo.url || "").match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?(?:[#?].*)?$/i);
  if (m) return m[1].toLowerCase();
  const name = String(repo.full_name || repo.name || "").toLowerCase().replace(/[^a-z0-9-_/]/g, "");
  return name || "";
}

async function findContentBySource(env, sourceType, sourceId) {
  if (!env?.COMMENTS_DB || !sourceId) return null;
  await ensureSchema(env);
  const rows = await env.COMMENTS_DB.prepare("SELECT * FROM content_items WHERE type = ? LIMIT 200").bind(sourceType).all();
  for (const row of rows.results || []) {
    let meta = {};
    try { meta = JSON.parse(row.metadata_json || "{}"); } catch { meta = {}; }
    if (String(meta.sourceId || "").toLowerCase() === String(sourceId).toLowerCase()) return row;
  }
  return null;
}

async function scanGithubRepos(username, fetchImpl = fetch) {
  const user = cleanOneLine(username, 64);
  if (!user) throw new Error("github username is required");
  const res = await fetchImpl(`https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=updated`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "shuangyue-about-admin" },
    signal: AbortSignal.timeout(GITHUB_SCAN_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  const repos = await res.json().catch(() => null);
  if (!Array.isArray(repos)) throw new Error("GitHub API returned an unexpected payload");
  return repos.map((r) => ({
    name: String(r.name || ""),
    full_name: String(r.full_name || ""),
    description: String(r.description || ""),
    html_url: String(r.html_url || ""),
    homepage: String(r.homepage || ""),
    language: String(r.language || ""),
    topics: Array.isArray(r.topics) ? r.topics.slice(0, 10) : [],
    stargazers_count: Number(r.stargazers_count) || 0,
    forks_count: Number(r.forks_count) || 0,
    updated_at: String(r.updated_at || ""),
    archived: Boolean(r.archived),
  })).filter((r) => r.name && r.html_url);
}

async function importGithubRepo(env, repo) {
  const sourceId = githubSourceId(repo);
  const slug = cleanOneLine(String(repo.name || "").toLowerCase(), 120).replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-") || `repo-${Date.now()}`;
  const now = new Date().toISOString();
  if (!env?.COMMENTS_DB) throw new Error("content storage is not configured");
  await ensureSchema(env);
  // Repeat scan/import never creates a second row. On dup, refresh only the
  // upstream-synced fields (url, source stats, timestamps); admin-owned
  // title/subtitle/summary/cover/sort_order/enabled (incl. manualReview) stay.
  if (sourceId) {
    const dup = await findContentBySource(env, "github", sourceId);
    if (dup) {
      let meta = {};
      try { meta = JSON.parse(dup.metadata_json || "{}"); } catch { meta = {}; }
      meta = {
        ...meta,
        sourceType: "github",
        sourceId,
        language: cleanOneLine(repo.language, 40),
        topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 10) : (meta.topics || []),
        stars: Number(repo.stargazers_count) || 0,
        forks: Number(repo.forks_count) || 0,
        archived: Boolean(repo.archived),
        homepage: cleanOneLine(repo.homepage, 300),
        githubUpdatedAt: cleanOneLine(repo.updated_at, 40),
      };
      await env.COMMENTS_DB.prepare(
        "UPDATE content_items SET url = ?, metadata_json = ?, updated_at = ? WHERE id = ?"
      ).bind(String(repo.html_url || dup.url || ""), JSON.stringify(meta).slice(0, 8000), now, dup.id).run();
      const refreshed = await env.COMMENTS_DB.prepare("SELECT * FROM content_items WHERE id = ?").bind(dup.id).first();
      return { item: adminContentItem(refreshed), deduped: true, refreshed: true };
    }
  }
  const metadata = {
    sourceType: "github",
    sourceId,
    language: cleanOneLine(repo.language, 40),
    topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 10) : [],
    stars: Number(repo.stargazers_count) || 0,
    forks: Number(repo.forks_count) || 0,
    archived: Boolean(repo.archived),
    homepage: cleanOneLine(repo.homepage, 300),
    githubUpdatedAt: cleanOneLine(repo.updated_at, 40),
  };
  const id = `github:${slug}`;
  await env.COMMENTS_DB.prepare(`
    INSERT INTO content_items (id, type, slug, title, subtitle, summary, cover, url, metadata_json, enabled, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).bind(
    id, "github", slug,
    JSON.stringify({ zh: repo.name, ja: repo.name, en: repo.name }),
    JSON.stringify({ zh: repo.language || "", ja: repo.language || "", en: repo.language || "" }),
    JSON.stringify({ zh: repo.description || "", ja: repo.description || "", en: repo.description || "" }),
    "", String(repo.html_url || ""), JSON.stringify(metadata), now, now
  ).run();
  const saved = await env.COMMENTS_DB.prepare("SELECT * FROM content_items WHERE id = ?").bind(id).first();
  return { item: adminContentItem(saved), deduped: false };
}

async function generateAiReview(env, id, repo = {}, overwrite = false) {
  if (!env?.COMMENTS_DB) throw new Error("content storage is not configured");
  await ensureSchema(env);
  const row = await env.COMMENTS_DB.prepare("SELECT * FROM content_items WHERE id = ?").bind(String(id)).first();
  if (!row) throw new Error("content not found");
  let meta = {};
  try { meta = JSON.parse(row.metadata_json || "{}"); } catch { meta = {}; }
  const existing = parseTri(row.summary);
  // Do not clobber a hand-written review unless the admin explicitly re-generates.
  if (!overwrite && meta.manualEdited && (existing.zh || existing.ja || existing.en)) {
    return adminContentItem(row);
  }
  if (!env.AI?.run) throw new Error("Workers AI binding is not configured");
  const config = await loadSiteConfig(env);
  const model = cleanOneLine(config.aiChatModel, 120) || DEFAULT_CHAT_MODEL;
  const prompt = [
    "You are writing a short personal showcase note for a GitHub project.",
    "Return compact JSON only: {\"zh\":\"...\",\"ja\":\"...\",\"en\":\"...\",\"tags\":[\"...\"]}.",
    "Each language 1-2 sentences, friendly, no hype, no code blocks.",
    `Project: ${cleanOneLine(repo.name || row.slug, 80)}`,
    `Description: ${cleanMessage(repo.description || existing.zh, 500)}`,
    `Language: ${cleanOneLine(repo.language || meta.language, 40)}`,
    `Topics: ${(Array.isArray(repo.topics) ? repo.topics : meta.topics || []).slice(0, 6).join(", ")}`,
  ].join("\n");
  const raw = await Promise.race([
    runTextModel(env, model, prompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error("AI review timed out")), AI_REVIEW_TIMEOUT_MS)),
  ]);
  const text = extractModelText(raw);
  const parsed = parseFirstJsonObject(text) || {};
  const summary = {
    zh: cleanMessage(parsed.zh, 500) || existing.zh,
    ja: cleanMessage(parsed.ja, 500) || existing.ja || existing.zh,
    en: cleanMessage(parsed.en, 500) || existing.en || existing.zh,
  };
  if (!summary.zh && !summary.ja && !summary.en) throw new Error("AI did not return a readable review");
  const tags = Array.isArray(parsed.tags) ? parsed.tags.map((t) => cleanOneLine(t, 24)).filter(Boolean).slice(0, 6) : [];
  meta = { ...meta, aiTags: tags, aiGeneratedAt: new Date().toISOString() };
  if (tags.length) meta.topics = [...new Set([...(meta.topics || []), ...tags])].slice(0, 10);
  await env.COMMENTS_DB.prepare("UPDATE content_items SET summary = ?, metadata_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(summary), JSON.stringify(meta), new Date().toISOString(), String(id)).run();
  const updated = await env.COMMENTS_DB.prepare("SELECT * FROM content_items WHERE id = ?").bind(String(id)).first();
  return adminContentItem(updated);
}

function sanitizeSiteConfig(payload, base = DEFAULT_SITE_CONFIG, env = {}) {
  const current = base || DEFAULT_SITE_CONFIG;
  const envModerationModel = cleanOneLine(env.COMMENT_MODERATION_MODEL, 120);
  const envChatModel = cleanOneLine(env.AI_CHAT_MODEL || env.ADMIN_AI_CHAT_MODEL, 120);
  return {
    commentsEnabled: typeof payload.commentsEnabled === "boolean" ? payload.commentsEnabled : current.commentsEnabled !== false,
    moderationEnabled: typeof payload.moderationEnabled === "boolean" ? payload.moderationEnabled : current.moderationEnabled !== false,
    migrationEnabled: typeof payload.migrationEnabled === "boolean" ? payload.migrationEnabled : current.migrationEnabled !== false,
    aiModel: cleanOneLine(payload.aiModel, 120) || envModerationModel || current.aiModel || DEFAULT_MODERATION_MODEL,
    aiChatModel: cleanOneLine(payload.aiChatModel, 120) || envChatModel || current.aiChatModel || DEFAULT_CHAT_MODEL,
    approvedCacheTtlSeconds: boundedInt(payload.approvedCacheTtlSeconds, current.approvedCacheTtlSeconds || DEFAULT_CACHE_TTL_SECONDS, 60, 3600),
    memoryCacheTtlSeconds: boundedInt(payload.memoryCacheTtlSeconds, current.memoryCacheTtlSeconds || DEFAULT_MEMORY_TTL_SECONDS, 1, 300),
    turnstileSiteKey: cleanOneLine(payload.turnstileSiteKey, 256) || cleanOneLine(env.TURNSTILE_SITE_KEY, 256) || current.turnstileSiteKey || "",
    title: localizedText(payload.title, current.title, 48),
    subtitle: localizedText(payload.subtitle, current.subtitle, 160),
    documentTitle: localizedText(payload.documentTitle, current.documentTitle, 72),
    notice: localizedText(payload.notice, current.notice, 180),
    updatedAt: cleanOneLine(payload.updatedAt, 40) || current.updatedAt || "",
  };
}

function localizedText(value, fallback, maxLength) {
  const source = value && typeof value === "object" ? value : {};
  return {
    zh: cleanOneLine(source.zh, maxLength) || fallback?.zh || "",
    ja: cleanOneLine(source.ja, maxLength) || fallback?.ja || fallback?.zh || "",
    en: cleanOneLine(source.en, maxLength) || fallback?.en || fallback?.zh || "",
  };
}

async function verifyTurnstile(request, env, token) {
  const secret = await loadSecret(env, "TURNSTILE_SECRET_KEY");
  if (!secret) return { ok: false, status: 503, errorCodes: ["missing-input-secret"] };
  const value = cleanOneLine(token, 2048);
  if (!value) return { ok: false, status: 400, errorCodes: ["missing-input-response"] };

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", value);
  const ip = clientIp(request);
  if (ip && ip !== "unknown") form.set("remoteip", ip);

  const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (response.ok && data.success) return { ok: true, data };
  return { ok: false, status: response.ok ? 400 : 503, errorCodes: data["error-codes"] || [`HTTP ${response.status}`] };
}

async function moderateComment(env, config, comment) {
  const model = cleanOneLine(config.aiModel, 120) || DEFAULT_MODERATION_MODEL;
  const local = localModerationCheck(comment);
  if (!local.safe) return local;

  if (!env.AI?.run) {
    return { safe: false, model, raw: {}, categories: [], reason: "Workers AI binding is not configured.", error: "missing AI binding" };
  }

  const content = [
    "Classify this user-submitted guestbook comment for a public personal website.",
    "Return compact JSON only: {\"safe\":true|false,\"categories\":[...],\"reason\":\"...\"}.",
    "Treat direct insults, profanity, personal attacks, harassment, threats, sexual content, hate, spam, and abuse as unsafe.",
    "",
    `Name: ${comment.name}`,
    `Comment: ${comment.message}`,
  ].join("\n");
  try {
    const result = await runTextModel(env, model, content);
    const parsed = parseModerationResult(result);
    return { ...parsed, model, raw: result };
  } catch (error) {
    return {
      safe: false,
      model,
      raw: {},
      categories: [],
      reason: "AI moderation failed; queued for manual review.",
      error: error?.message || "AI moderation failed",
    };
  }
}

function localModerationCheck(comment) {
  const text = `${comment.name || ""}\n${comment.message || ""}`.toLowerCase();
  const abusivePatterns = [
    /f[\W_]*u[\W_]*c[\W_]*k/i,
    /\bshit\b/i,
    /\bbitch\b/i,
    /\basshole\b/i,
    /\bcunt\b/i,
    /\bdick\b/i,
    /\bidiot\b/i,
    /\bmoron\b/i,
    /\bretard\b/i,
    /\bnmsl\b/i,
    /\bcnm\b/i,
    /傻[逼比屄]/,
    /煞笔/,
    /操你/,
    /草你/,
    /艹你/,
    /妈的/,
    /你妈/,
    /几把/,
    /鸡巴/,
    /滚/,
    /废物/,
    /垃圾/,
  ];

  const matched = abusivePatterns.find((pattern) => pattern.test(text));
  if (!matched) return { safe: true };

  return {
    safe: false,
    model: "local-abuse-filter",
    raw: { matched: String(matched) },
    categories: ["harassment", "profanity"],
    reason: "Local moderation matched abusive or profane language.",
    error: "",
  };
}

async function runTextModel(env, model, content) {
  return env.AI.run(model, {
    messages: [
      { role: "user", content },
    ],
  });
}

function extractModelText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (typeof result.result === "string") return result.result;
  if (typeof result.text === "string") return result.text;
  if (Array.isArray(result.choices)) {
    const choice = result.choices[0];
    return choice?.message?.content || choice?.text || "";
  }
  return "";
}

function parseModerationResult(result) {
  const direct = extractModelText(result);
  const parsed = parseFirstJsonObject(direct);
  if (parsed && typeof parsed.safe === "boolean") {
    const categories = Array.isArray(parsed.categories) ? parsed.categories.map((item) => cleanOneLine(item, 40)).filter(Boolean) : [];
    return {
      safe: parsed.safe,
      categories,
      reason: cleanOneLine(parsed.reason, 400) || (parsed.safe ? "" : "AI classified this comment as unsafe."),
    };
  }

  const text = JSON.stringify(result || {}).toLowerCase();
  const source = String(direct || text).toLowerCase();
  const unsafe = /\bunsafe\b/.test(source) || /violence|hate|sexual|self-harm|criminal|harassment|profanity|abuse|spam/.test(source);
  const safe = !unsafe && /\bsafe\b/.test(source);
  const categories = [];
  for (const category of ["violence", "hate", "sexual", "self-harm", "criminal", "harassment", "illicit", "weapons", "profanity", "abuse", "spam"]) {
    if (source.includes(category)) categories.push(category);
  }
  return {
    safe,
    categories,
    reason: unsafe ? "Workers AI classified this comment as unsafe." : safe ? "" : "AI moderation was inconclusive; queued for manual review.",
  };
}

function parseFirstJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function adminHealth(env) {
  const turnstileSecret = Boolean(await loadSecret(env, "TURNSTILE_SECRET_KEY"));
  const adminPassword = Boolean(await loadAdminPassword(env));
  const telegramToken = Boolean(await loadSecret(env, "TELEGRAM_BOT_TOKEN"));
  const telegramChatId = Boolean(await loadSecret(env, "TELEGRAM_CHAT_ID"));
  const moderationModel = cleanOneLine(env.COMMENT_MODERATION_MODEL, 120);
  const chatModel = cleanOneLine(env.AI_CHAT_MODEL || env.ADMIN_AI_CHAT_MODEL, 120);
  const envChecks = [
    { name: "COMMENTS_DB", ok: Boolean(env.COMMENTS_DB) },
    { name: "COMMENTS_KV", ok: Boolean(env.COMMENTS_KV) },
    { name: "AI", ok: Boolean(env.AI?.run) },
    { name: "ADMIN_PASSWORD", ok: adminPassword },
    { name: "TURNSTILE_SECRET_KEY", ok: turnstileSecret },
    { name: "TURNSTILE_SITE_KEY", ok: Boolean(cleanOneLine(env.TURNSTILE_SITE_KEY, 256)), optional: true },
    { name: "TELEGRAM_BOT_TOKEN", ok: telegramToken, optional: true },
    { name: "TELEGRAM_CHAT_ID", ok: telegramChatId, optional: true },
    { name: "COMMENT_MODERATION_MODEL", ok: Boolean(moderationModel), optional: true },
    { name: "AI_CHAT_MODEL", ok: Boolean(chatModel), optional: true },
    { name: "RUNTIME_SCHEMA_BOOTSTRAP", ok: env.RUNTIME_SCHEMA_BOOTSTRAP === "1", optional: true },
  ];
  return {
    d1: Boolean(env.COMMENTS_DB),
    kv: Boolean(env.COMMENTS_KV),
    ai: Boolean(env.AI?.run),
    turnstileSecret,
    adminPassword,
    telegram: telegramToken && telegramChatId,
    checks: envChecks,
  };
}

async function adminSession(request, env) {
  const adminPassword = await loadAdminPassword(env);
  if (!adminPassword) return null;
  const token = cookieValue(request.headers.get("Cookie"), ADMIN_COOKIE_NAME);
  if (!token) return null;
  return verifyAdminToken(adminPassword, token);
}

async function createAdminToken(adminPassword) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({
    iat: now,
    exp: now + ADMIN_SESSION_SECONDS,
    role: "admin",
  }));
  const signature = await signText(adminPassword, payload);
  return `${payload}.${signature}`;
}

async function verifyAdminToken(adminPassword, token) {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;

    const expected = await signText(adminPassword, payload);
    if (!(await timingSafeEqual(signature, expected))) return null;

    const data = JSON.parse(base64UrlDecode(payload));
    if (data.role !== "admin" || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

async function loadAdminPassword(env) {
  for (const key of ADMIN_PASSWORD_KEYS) {
    const value = await loadSecret(env, key);
    if (value) return value;
  }
  return "";
}

async function loadSecret(env, key) {
  const direct = await readSecretBinding(env?.[key], key);
  if (direct) return direct;

  for (const storeKey of ADMIN_SECRET_STORE_KEYS) {
    const store = env?.[storeKey];
    if (!store || typeof store.get !== "function") continue;
    const value = await readSecretBinding(store, key);
    if (value) return value;
  }

  return "";
}

async function readSecretBinding(binding, key) {
  if (!binding) return "";
  if (typeof binding === "string") return cleanOneLine(binding, 2048);
  if (typeof binding.get !== "function") return "";

  for (const args of [[key], []]) {
    try {
      const value = await binding.get(...args);
      if (typeof value === "string") return cleanOneLine(value, 2048);
      if (value && typeof value === "object" && typeof value.value === "string") {
        return cleanOneLine(value.value, 2048);
      }
    } catch {
      // Try the next binding shape.
    }
  }

  return "";
}

async function verifyPassword(input, expected) {
  const inputHash = await sha256Hex(String(input || ""));
  const expectedHash = await sha256Hex(String(expected || ""));
  return timingSafeEqual(inputHash, expectedHash);
}

async function signText(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function sha256Hex(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] || 0) ^ (right[index] || 0);
  }
  return diff === 0;
}

function cookieValue(header, name) {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

function base64UrlEncode(value) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  const padded = String(value || "").replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function publicComment(comment) {
  return {
    id: String(comment.id || ""),
    name: cleanOneLine(comment.name, 32) || "Anonymous",
    message: cleanMessage(comment.message, 500),
    ip: cleanOneLine(comment.ip, 64) || "unknown",
    ipLocation: cleanOneLine(comment.ipLocation || comment.location, 120) || "Unknown location",
    createdAt: cleanOneLine(comment.createdAt, 40),
  };
}

function adminComment(comment) {
  return {
    ...publicComment(comment),
    status: cleanOneLine(comment.status, 20) || "approved",
    updatedAt: cleanOneLine(comment.updatedAt, 40),
    reviewedAt: cleanOneLine(comment.reviewedAt, 40),
    moderationModel: cleanOneLine(comment.moderationModel, 120),
    moderationCategories: cleanOneLine(comment.moderationCategories, 240),
    moderationReason: cleanOneLine(comment.moderationReason, 400),
    moderationError: cleanOneLine(comment.moderationError, 400),
    moderationResult: cleanOneLine(comment.moderationResult, 1200),
  };
}

function commentFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    message: row.message,
    ip: row.ip,
    ipLocation: row.ip_location,
    status: row.status,
    moderationModel: row.moderation_model,
    moderationResult: row.moderation_result,
    moderationCategories: row.moderation_categories,
    moderationReason: row.moderation_reason,
    moderationError: row.moderation_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
  };
}

function cleanOneLine(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanMessage(value, maxLength) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxLength);
}

function cleanPath(value) {
  const path = cleanOneLine(value, 220) || "/";
  if (!path.startsWith("/")) return "/";
  return path.split("#")[0].split("?")[0] || "/";
}

function commentLimit(value) {
  const limit = Number.parseInt(value || "", 10);
  if (!Number.isFinite(limit)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(limit, 1), MAX_STORED_COMMENTS);
}

function boundedInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function refererPage(request) {
  try {
    return cleanPath(new URL(request.headers.get("referer") || "").pathname);
  } catch {
    return "/";
  }
}

function refererLang(request) {
  try {
    const first = new URL(request.headers.get("referer") || "").pathname.split("/").filter(Boolean)[0] || "";
    return first === "en" || first === "ja" ? first : "zh";
  } catch {
    return "zh";
  }
}

function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function clientLocation(request) {
  const cf = request.cf || {};
  const parts = [
    countryName(cf.country),
    locationName(cf.region),
    locationName(cf.city),
  ].filter(Boolean).filter((part, index, list) => list.indexOf(part) === index);

  return parts.length ? parts.join(" / ") : "Unknown location";
}

function locationName(value) {
  const text = cleanOneLine(value, 80);
  if (!text) return "";

  const names = {
    Anhui: "安徽",
    Beijing: "北京",
    Chongqing: "重庆",
    Fujian: "福建",
    Gansu: "甘肃",
    Guangdong: "广东",
    Guangxi: "广西",
    Guizhou: "贵州",
    Hainan: "海南",
    Hebei: "河北",
    Heilongjiang: "黑龙江",
    Henan: "河南",
    Hubei: "湖北",
    Hunan: "湖南",
    "Inner Mongolia": "内蒙古",
    Jiangsu: "江苏",
    Jiangxi: "江西",
    Jilin: "吉林",
    Liaoning: "辽宁",
    Ningxia: "宁夏",
    Qinghai: "青海",
    Shaanxi: "陕西",
    Shandong: "山东",
    Shanghai: "上海",
    Shanxi: "山西",
    Sichuan: "四川",
    Tianjin: "天津",
    Tibet: "西藏",
    Xinjiang: "新疆",
    Yunnan: "云南",
    Zhejiang: "浙江",
    Hohhot: "呼和浩特",
    Baotou: "包头",
    Chifeng: "赤峰",
    Ulanqab: "乌兰察布",
    Wuhan: "武汉",
    Xiamen: "厦门",
    Nanjing: "南京",
    Qingdao: "青岛",
    Jinan: "济南",
    Changsha: "长沙",
    Zhangjiajie: "张家界",
    "Xi'an": "西安",
    Dunhuang: "敦煌",
    Tokyo: "东京",
    Osaka: "大阪",
    Kyoto: "京都",
  };

  return names[text] || text;
}

function countryName(code) {
  const countries = {
    CN: "中国",
    HK: "中国香港",
    MO: "中国澳门",
    TW: "中国台湾",
    JP: "日本",
    KR: "韩国",
    US: "美国",
    SG: "新加坡",
  };
  return countries[String(code || "").toUpperCase()] || code || "";
}

function json(data, status = 200, extraHeaders = {}, baseHeaders = publicApiHeaders()) {
  return new Response(JSON.stringify(data), { status, headers: { ...baseHeaders, ...extraHeaders } });
}

function jsonAdmin(data, status = 200, extraHeaders = {}) {
  return json(data, status, extraHeaders, adminApiHeaders());
}

function serviceErrorResponse(error, admin = false) {
  const requestId = crypto.randomUUID();
  console.error(`[api error ${requestId}]`, error);
  return json({ error: "service unavailable", requestId }, 503, {}, admin ? adminApiHeaders() : publicApiHeaders());
}

function rateLimitedResponse(retryAfter, admin = false) {
  return json({ error: "too many requests", retryAfter }, 429, { "retry-after": String(retryAfter) }, admin ? adminApiHeaders() : publicApiHeaders());
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function publicApiHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, accept",
    ...SECURITY_HEADERS,
  };
}

function adminApiHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...SECURITY_HEADERS,
  };
}

// Fixed-window counters kept only in isolate memory: 0 KV reads, 0 KV writes,
// 0 KV deletes. Same bucket math as rateLimitCheck so limits behave identically
// within one isolate. Entries expire with the window (2x TTL, like KV) and the
// map is bounded to avoid unbounded growth; eviction only resets counters
// (fail-open briefly), never blocks legitimate traffic.
function memoryRateLimitCheck(scope, id, limits) {
  const now = Date.now();
  if (memory.rateLimits.size > 2000) {
    for (const [key, entry] of memory.rateLimits) {
      if (entry.expiresAt <= now) memory.rateLimits.delete(key);
    }
    if (memory.rateLimits.size > 2000) memory.rateLimits.clear();
  }
  // Memory-only and ephemeral (per isolate, never persisted or logged), so the
  // raw truncated identifier is sufficient here; KV keys remain hashed.
  const safeId = cleanOneLine(id, 128) || "unknown";

  // Read all windows first and only advance counters when the request is
  // allowed: blocked requests neither burn quota nor inflate later windows.
  const pending = [];
  for (const { limit, windowSeconds } of limits) {
    const windowMs = windowSeconds * 1000;
    const bucket = Math.floor(now / windowMs);
    const key = `mem:${scope}:${safeId}:${windowSeconds}s:${bucket}`;
    let entry = memory.rateLimits.get(key);
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + windowMs * 2 };
      memory.rateLimits.set(key, entry);
    }
    if (entry.count >= limit) {
      const retryAfter = Math.max(1, windowSeconds - Math.floor((now % windowMs) / 1000));
      return { limited: true, retryAfter };
    }
    pending.push(entry);
  }
  for (const entry of pending) entry.count += 1;

  return { limited: false, retryAfter: 0 };
}

async function rateLimitCheck(env, scope, id, limits) {
  if (!env.COMMENTS_KV) return { limited: false, retryAfter: 0 };
  // Hash the client identifier so KV keys never store raw IPs in plaintext.
  // Keys keep a short TTL (2x window) and only low-volume API writes touch KV.
  const safeId = (await sha256Hex(cleanOneLine(id, 128) || "unknown")).slice(0, 32);
  const now = Date.now();

  // Read all windows before writing: a blocked request costs only GETs and
  // never inflates the counters a later legitimate request would be judged by.
  const pending = [];
  for (const { limit, windowSeconds } of limits) {
    const windowMs = windowSeconds * 1000;
    const bucket = Math.floor(now / windowMs);
    const key = `${RATE_LIMIT_PREFIX}:${scope}:${safeId}:${windowSeconds}s:${bucket}`;
    const count = Number.parseInt(await env.COMMENTS_KV.get(key).catch(() => "0") || "0", 10) || 0;
    if (count >= limit) {
      const retryAfter = Math.max(1, windowSeconds - Math.floor((now % windowMs) / 1000));
      return { limited: true, retryAfter };
    }
    pending.push({ key, count, windowSeconds });
  }
  for (const { key, count, windowSeconds } of pending) {
    await env.COMMENTS_KV.put(key, String(count + 1), { expirationTtl: windowSeconds * 2 }).catch(() => {});
  }

  return { limited: false, retryAfter: 0 };
}
