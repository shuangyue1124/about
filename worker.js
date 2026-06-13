export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
const MAX_STORED_COMMENTS = 100;
const DEFAULT_LIST_LIMIT = 30;

export async function handleComments(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders() });

  try {
    if (request.method === "GET") {
      const limit = commentLimit(new URL(request.url).searchParams.get("limit"));
      const comments = await listComments(env, limit);
      return json({ comments });
    }

    if (request.method === "POST") {
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: apiHeaders() });
}

function apiHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
}
