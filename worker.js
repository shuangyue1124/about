export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/site" || url.pathname === "/api/site/") {
      return handleSite(request, env);
    }

    if (url.pathname.startsWith("/api/admin")) {
      return handleAdmin(request, env);
    }

    if (url.pathname === "/api/comments" || url.pathname === "/api/comments/") {
      return handleComments(request, env);
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
const DEFAULT_MODERATION_MODEL = "@cf/meta/llama-guard-3-8b";
const MAX_STORED_COMMENTS = 100;
const DEFAULT_LIST_LIMIT = 30;
const ADMIN_SESSION_SECONDS = 60 * 60 * 24;
const DEFAULT_CACHE_TTL_SECONDS = 60;
const DEFAULT_MEMORY_TTL_SECONDS = 15;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const memory = {
  comments: null,
  commentsExpiresAt: 0,
  config: null,
  configExpiresAt: 0,
  schemaReady: false,
};

const DEFAULT_SITE_CONFIG = {
  commentsEnabled: true,
  moderationEnabled: true,
  migrationEnabled: true,
  aiModel: DEFAULT_MODERATION_MODEL,
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

export async function handleComments(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders() });

  try {
    if (request.method === "GET") {
      const limit = commentLimit(new URL(request.url).searchParams.get("limit"));
      const comments = await listApprovedComments(env, limit);
      return json({ comments });
    }

    if (request.method === "POST") {
      const config = await loadSiteConfig(env);
      if (!config.commentsEnabled) return json({ error: "comments are closed" }, 403);

      const payload = await request.json().catch(() => ({}));
      if (payload.website) return json({ ok: true, status: "pending" }, 202);

      const name = cleanOneLine(payload.name, 32);
      const message = cleanMessage(payload.message, 500);
      if (!name || !message) return json({ error: "name and message are required" }, 400);

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

      return json({ comment: publicComment(comment), status: comment.status }, comment.status === "approved" ? 201 : 202);
    }

    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    return json({ error: error?.message || "comments unavailable" }, 503);
  }
}

export async function handleSite(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders() });
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
  const settings = await loadSiteConfig(env);
  return json({ settings: publicSiteSettings(settings) });
}

export async function handleAdmin(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders() });

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/api/admin";

  try {
    if (path === "/api/admin/login" && request.method === "POST") {
      return adminLogin(request, env);
    }

    if (path === "/api/admin/logout" && request.method === "POST") {
      return json({ ok: true }, 200, {
        "set-cookie": `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      });
    }

    const session = await adminSession(request, env);
    if (!session) return json({ error: "unauthorized" }, 401);

    if (request.method !== "GET" && request.headers.get("x-admin-action") !== "1") {
      return json({ error: "missing admin action header" }, 403);
    }

    if ((path === "/api/admin" || path === "/api/admin/me") && request.method === "GET") {
      return json({ ok: true, expiresAt: session.exp * 1000 });
    }

    if (path === "/api/admin/health" && request.method === "GET") {
      return json({ health: await adminHealth(env) });
    }

    if ((path === "/api/admin/config" || path === "/api/admin/settings") && request.method === "GET") {
      const config = await loadSiteConfig(env);
      return json({ config, settings: config });
    }

    if ((path === "/api/admin/config" || path === "/api/admin/settings") && request.method === "PUT") {
      const payload = await request.json().catch(() => ({}));
      const current = await loadSiteConfig(env);
      const config = sanitizeSiteConfig(payload.config || payload, current);
      config.updatedAt = new Date().toISOString();
      await saveSiteConfig(env, config);
      await refreshApprovedCommentsCache(env);
      return json({ config, settings: config });
    }

    if (path === "/api/admin/comments" && request.method === "GET") {
      const limit = commentLimit(url.searchParams.get("limit") || String(MAX_STORED_COMMENTS));
      const status = cleanOneLine(url.searchParams.get("status"), 20) || "all";
      const comments = await listAdminComments(env, limit, status);
      return json({ comments });
    }

    if (path === "/api/admin/migrate-comments" && request.method === "POST") {
      const config = await loadSiteConfig(env);
      if (!config.migrationEnabled) return json({ error: "migration is disabled" }, 403);
      return json({ result: await migrateLegacyComments(env) });
    }

    if (path.startsWith("/api/admin/comments/")) {
      const id = decodeURIComponent(path.slice("/api/admin/comments/".length));
      if (!id) return json({ error: "comment id is required" }, 400);

      if (request.method === "PATCH") {
        const payload = await request.json().catch(() => ({}));
        const status = cleanOneLine(payload.status, 20);
        if (!["approved", "pending", "rejected"].includes(status)) {
          return json({ error: "invalid comment status" }, 400);
        }
        const comment = await updateCommentStatus(env, id, status);
        if (status !== "pending") await refreshApprovedCommentsCache(env);
        return json({ comment });
      }

      if (request.method === "DELETE") {
        await deleteComment(env, id);
        await refreshApprovedCommentsCache(env);
        return json({ ok: true });
      }
    }

    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    return json({ error: error?.message || "admin unavailable" }, 503);
  }
}

async function adminLogin(request, env) {
  const adminPassword = await loadAdminPassword(env);
  if (!adminPassword) {
    return json({
      error: "Admin password is not configured for this deployment. Set ADMIN_PASSWORD on the Worker or Pages project that serves this custom domain.",
    }, 503);
  }

  const payload = await request.json().catch(() => ({}));
  const password = String(payload.password || "");
  const ok = await verifyPassword(password, adminPassword);
  if (!ok) return json({ error: "invalid password" }, 401);

  const token = await createAdminToken(adminPassword);
  return json({ ok: true }, 200, {
    "set-cookie": `${ADMIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ADMIN_SESSION_SECONDS}`,
  });
}

async function ensureSchema(env) {
  if (!env.COMMENTS_DB || memory.schemaReady) return;
  await env.COMMENTS_DB.exec(`
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
    );
    CREATE INDEX IF NOT EXISTS idx_comments_status_created ON comments (status, created_at DESC);
    CREATE TABLE IF NOT EXISTS site_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
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

  if (env.COMMENTS_KV) {
    await env.COMMENTS_KV.put(SITE_SETTINGS_KEY, JSON.stringify(next));
  }

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

function sanitizeSiteConfig(payload, base = DEFAULT_SITE_CONFIG, env = {}) {
  const current = base || DEFAULT_SITE_CONFIG;
  return {
    commentsEnabled: typeof payload.commentsEnabled === "boolean" ? payload.commentsEnabled : current.commentsEnabled !== false,
    moderationEnabled: typeof payload.moderationEnabled === "boolean" ? payload.moderationEnabled : current.moderationEnabled !== false,
    migrationEnabled: typeof payload.migrationEnabled === "boolean" ? payload.migrationEnabled : current.migrationEnabled !== false,
    aiModel: cleanOneLine(payload.aiModel, 120) || current.aiModel || DEFAULT_MODERATION_MODEL,
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
  if (!env.AI?.run) {
    return { safe: false, model, raw: {}, categories: [], reason: "Workers AI binding is not configured.", error: "missing AI binding" };
  }

  const content = `Name: ${comment.name}\nComment: ${comment.message}`;
  try {
    const result = await env.AI.run(model, {
      messages: [
        { role: "system", content: "Classify this user-submitted guestbook comment. Return safe or unsafe and any unsafe categories." },
        { role: "user", content },
      ],
    });
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

function parseModerationResult(result) {
  const text = JSON.stringify(result || {}).toLowerCase();
  const direct = String(result?.response || result?.result || result?.text || "").toLowerCase();
  const source = direct || text;
  const unsafe = /\bunsafe\b/.test(source) || /violence|hate|sexual|self-harm|criminal|harassment/.test(source);
  const safe = !unsafe && (/\bsafe\b/.test(source) || !source);
  const categories = [];
  for (const category of ["violence", "hate", "sexual", "self-harm", "criminal", "harassment", "illicit", "weapons"]) {
    if (source.includes(category)) categories.push(category);
  }
  return {
    safe,
    categories,
    reason: unsafe ? "Workers AI classified this comment as unsafe." : "",
  };
}

async function adminHealth(env) {
  return {
    d1: Boolean(env.COMMENTS_DB),
    kv: Boolean(env.COMMENTS_KV),
    ai: Boolean(env.AI?.run),
    turnstileSecret: Boolean(await loadSecret(env, "TURNSTILE_SECRET_KEY")),
    adminPassword: Boolean(await loadAdminPassword(env)),
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

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...apiHeaders(), ...extraHeaders } });
}

function apiHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-admin-action",
  };
}
