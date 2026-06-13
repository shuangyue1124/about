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

const COMMENT_INDEX_KEY = "comments:index";
const SITE_SETTINGS_KEY = "site:settings";
const ADMIN_COOKIE_NAME = "sfsy_admin";
const MAX_STORED_COMMENTS = 100;
const DEFAULT_LIST_LIMIT = 30;
const ADMIN_SESSION_SECONDS = 60 * 60 * 24;
const DEFAULT_SITE_SETTINGS = {
  commentsEnabled: true,
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
      const comments = await listComments(env, limit);
      return json({ comments });
    }

    if (request.method === "POST") {
      const settings = await loadSiteSettings(env);
      if (!settings.commentsEnabled) return json({ error: "comments are closed" }, 403);

      const payload = await request.json().catch(() => ({}));
      if (payload.website) return json({ ok: true }, 202);

      const name = cleanOneLine(payload.name, 32);
      const message = cleanMessage(payload.message, 500);
      if (!name || !message) return json({ error: "name and message are required" }, 400);

      const comment = {
        id: crypto.randomUUID(),
        name,
        message,
        ip: clientIp(request),
        ipLocation: clientLocation(request),
        createdAt: new Date().toISOString(),
      };

      await saveComment(env, comment);
      return json({ comment }, 201);
    }

    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    return json({ error: error?.message || "comments unavailable" }, 503);
  }
}

export async function handleSite(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders() });
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
  const settings = await loadSiteSettings(env);
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

    if (path === "/api/admin/settings" && request.method === "GET") {
      const settings = await loadSiteSettings(env);
      return json({ settings });
    }

    if (path === "/api/admin/settings" && request.method === "PUT") {
      const payload = await request.json().catch(() => ({}));
      const current = await loadSiteSettings(env);
      const settings = sanitizeSiteSettings(payload, current);
      settings.updatedAt = new Date().toISOString();
      await saveSiteSettings(env, settings);
      return json({ settings });
    }

    if (path === "/api/admin/comments" && request.method === "GET") {
      const limit = commentLimit(url.searchParams.get("limit") || String(MAX_STORED_COMMENTS));
      const comments = await listComments(env, limit);
      return json({ comments });
    }

    if (path.startsWith("/api/admin/comments/") && request.method === "DELETE") {
      const id = decodeURIComponent(path.slice("/api/admin/comments/".length));
      if (!id) return json({ error: "comment id is required" }, 400);
      await deleteComment(env, id);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    return json({ error: error?.message || "admin unavailable" }, 503);
  }
}

async function adminLogin(request, env) {
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD is not configured" }, 503);

  const payload = await request.json().catch(() => ({}));
  const password = String(payload.password || "");
  const ok = await verifyPassword(password, env.ADMIN_PASSWORD);
  if (!ok) return json({ error: "invalid password" }, 401);

  const token = await createAdminToken(env);
  return json({ ok: true }, 200, {
    "set-cookie": `${ADMIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ADMIN_SESSION_SECONDS}`,
  });
}

async function listComments(env, limit) {
  const store = commentStore(env);
  if (!store) return [];
  return (await store.list(limit)).map(publicComment).slice(0, limit);
}

async function saveComment(env, comment) {
  const store = commentStore(env);
  if (!store) throw new Error("comment storage is not configured");
  await store.save(comment);
}

async function deleteComment(env, id) {
  const store = commentStore(env);
  if (!store?.delete) throw new Error("comment deletion is not configured");
  await store.delete(id);
}

function commentStore(env) {
  const mode = String(env.COMMENTS_STORAGE || "kv").toLowerCase();
  const kvStore = env.COMMENTS_KV ? kvCommentStore(env.COMMENTS_KV) : null;
  const remoteStore = env.COMMENTS_DB_URL ? remoteCommentStore(env) : null;

  if (mode === "remote") return remoteStore || kvStore;
  if (mode === "dual") return dualCommentStore(remoteStore, kvStore);
  return kvStore || remoteStore;
}

function kvCommentStore(kv) {
  return {
    async list(limit) {
      const comments = await kv.get(COMMENT_INDEX_KEY, "json");
      return Array.isArray(comments) ? comments.slice(0, limit) : [];
    },
    async save(comment) {
      const comments = await this.list(MAX_STORED_COMMENTS);
      const next = [comment, ...comments.filter((item) => item.id !== comment.id)].slice(0, MAX_STORED_COMMENTS);
      await kv.put(COMMENT_INDEX_KEY, JSON.stringify(next));
    },
    async delete(id) {
      const comments = await this.list(MAX_STORED_COMMENTS);
      const next = comments.filter((item) => String(item.id || "") !== String(id));
      await kv.put(COMMENT_INDEX_KEY, JSON.stringify(next));
    },
  };
}

function remoteCommentStore(env) {
  return {
    async list(limit) {
      const url = new URL(env.COMMENTS_DB_URL);
      url.searchParams.set("limit", String(limit));
      const response = await fetch(url, { headers: remoteHeaders(env) });
      if (!response.ok) throw new Error("remote comment list failed");
      const data = await response.json();
      const comments = Array.isArray(data) ? data : data.comments;
      return Array.isArray(comments) ? comments.slice(0, limit) : [];
    },
    async save(comment) {
      const response = await fetch(env.COMMENTS_DB_URL, {
        method: "POST",
        headers: remoteHeaders(env),
        body: JSON.stringify(comment),
      });
      if (!response.ok) throw new Error("remote comment save failed");
    },
    async delete(id) {
      const url = new URL(env.COMMENTS_DB_URL);
      url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
      const response = await fetch(url, {
        method: "DELETE",
        headers: remoteHeaders(env),
      });
      if (!response.ok) throw new Error("remote comment delete failed");
    },
  };
}

function dualCommentStore(remoteStore, kvStore) {
  if (!remoteStore && !kvStore) return null;
  return {
    async list(limit) {
      if (remoteStore) {
        try {
          return await remoteStore.list(limit);
        } catch {
          // Fall back to KV if the remote database is temporarily unavailable.
        }
      }
      return kvStore ? kvStore.list(limit) : [];
    },
    async save(comment) {
      const writes = [remoteStore, kvStore].filter(Boolean).map((store) => store.save(comment));
      const results = await Promise.allSettled(writes);
      if (results.every((result) => result.status === "rejected")) {
        throw new Error("all comment stores failed");
      }
    },
    async delete(id) {
      const writes = [remoteStore, kvStore].filter(Boolean).filter((store) => store.delete).map((store) => store.delete(id));
      const results = await Promise.allSettled(writes);
      if (!results.length || results.every((result) => result.status === "rejected")) {
        throw new Error("all comment stores failed");
      }
    },
  };
}

function remoteHeaders(env) {
  const headers = { accept: "application/json", "content-type": "application/json" };
  if (env.COMMENTS_DB_TOKEN) headers.authorization = `Bearer ${env.COMMENTS_DB_TOKEN}`;
  return headers;
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

async function loadSiteSettings(env) {
  const stored = env.COMMENTS_KV ? await env.COMMENTS_KV.get(SITE_SETTINGS_KEY, "json") : null;
  return sanitizeSiteSettings(stored || {}, DEFAULT_SITE_SETTINGS);
}

async function saveSiteSettings(env, settings) {
  if (!env.COMMENTS_KV) throw new Error("site settings storage is not configured");
  await env.COMMENTS_KV.put(SITE_SETTINGS_KEY, JSON.stringify(settings));
}

function publicSiteSettings(settings) {
  return {
    commentsEnabled: settings.commentsEnabled !== false,
    title: settings.title,
    subtitle: settings.subtitle,
    documentTitle: settings.documentTitle,
    notice: settings.notice,
    updatedAt: settings.updatedAt || "",
  };
}

function sanitizeSiteSettings(payload, base = DEFAULT_SITE_SETTINGS) {
  const current = base || DEFAULT_SITE_SETTINGS;
  return {
    commentsEnabled: typeof payload.commentsEnabled === "boolean" ? payload.commentsEnabled : current.commentsEnabled !== false,
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

async function adminSession(request, env) {
  if (!env.ADMIN_PASSWORD) return null;
  const token = cookieValue(request.headers.get("Cookie"), ADMIN_COOKIE_NAME);
  if (!token) return null;
  return verifyAdminToken(env, token);
}

async function createAdminToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({
    iat: now,
    exp: now + ADMIN_SESSION_SECONDS,
    role: "admin",
  }));
  const signature = await signText(env.ADMIN_PASSWORD, payload);
  return `${payload}.${signature}`;
}

async function verifyAdminToken(env, token) {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;

    const expected = await signText(env.ADMIN_PASSWORD, payload);
    if (!(await timingSafeEqual(signature, expected))) return null;

    const data = JSON.parse(base64UrlDecode(payload));
    if (data.role !== "admin" || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
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
    "Zhangjiajie": "张家界",
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
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-admin-action",
  };
}
