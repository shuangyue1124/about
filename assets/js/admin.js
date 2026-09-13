const app = document.getElementById("adminApp");
const defaultAiModel = "@cf/meta/llama-3.2-3b-instruct";
const AI_CHAT_TIMEOUT_MS = 60000;

const emptyConfig = {
  commentsEnabled: true,
  moderationEnabled: true,
  migrationEnabled: true,
  aiModel: defaultAiModel,
  aiChatModel: defaultAiModel,
  approvedCacheTtlSeconds: 60,
  memoryCacheTtlSeconds: 15,
  turnstileSiteKey: "",
  title: { zh: "", ja: "", en: "" },
  subtitle: { zh: "", ja: "", en: "" },
  documentTitle: { zh: "", ja: "", en: "" },
  notice: { zh: "", ja: "", en: "" },
};

const state = {
  authed: false,
  loading: true,
  config: emptyConfig,
  comments: [],
  health: null,
  statusFilter: "pending",
  status: "",
  chatMessages: [
    { role: "assistant", content: "可以问我访问量、热门页面、最近事件、评论审核状态等。数据来自 D1，只读查询。" },
  ],
  chatLoading: false,
  chatDataAt: "",
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = {
    accept: "application/json",
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(method !== "GET" && path.startsWith("/api/admin/") && path !== "/api/admin/login" ? { "x-admin-action": "1" } : {}),
    ...(options.headers || {}),
  };

  return fetch(path, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
  });
}

function shell(content) {
  return `
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <header class="topbar">
      <a class="brand" href="./" aria-label="返回首页">
        <span class="brand__mark brand__mark--avatar">
          <img src="/assets/images/avatar.webp" alt="朔风霜月头像" loading="lazy">
        </span>
        <span>
          <span class="brand__name">朔风霜月</span>
          <span class="brand__kicker">Admin</span>
        </span>
      </a>
      <nav class="topnav" aria-label="Admin">
        <a href="./">首页</a>
        <a href="./travel/">旅行</a>
        <a href="./admin.html" aria-current="page">管理</a>
      </nav>
      ${state.authed ? '<button class="btn" type="button" id="logoutButton">退出登录</button>' : ""}
    </header>
    <main class="admin-shell" id="main-content" tabindex="-1">
      ${content}
    </main>
  `;
}

function render() {
  if (state.loading) {
    app.innerHTML = shell(`
      <section class="admin-hero">
        <p class="eyebrow">Admin</p>
        <h1>正在检查登录状态</h1>
        <p>后台用于审核留言、配置运行时策略并检查 Cloudflare 绑定状态。</p>
      </section>
    `);
    return;
  }

  app.innerHTML = state.authed ? shell(dashboard()) : shell(loginView());
  bind();
}

function loginView() {
  return `
    <section class="admin-hero">
      <p class="eyebrow">Admin Login</p>
      <h1>站点管理</h1>
      <p>输入 Cloudflare 环境变量 <code>ADMIN_PASSWORD</code> 中配置的管理员密码。敏感密钥仍通过 Cloudflare Secrets 管理，不会在后台明文显示。</p>
    </section>
    <section class="admin-panel" aria-labelledby="login-title">
      <h2 id="login-title">管理员登录</h2>
      <form class="admin-form" id="loginForm">
        <label>
          <span>管理员密码</span>
          <input name="password" type="password" autocomplete="current-password" required autofocus>
        </label>
        <div class="admin-actions">
          <button class="btn btn--primary" type="submit">登录</button>
        </div>
        <p class="admin-status" id="loginStatus" role="status">${esc(state.status)}</p>
      </form>
    </section>
  `;
}

function dashboard() {
  const config = state.config || emptyConfig;
  return `
    <section class="admin-hero">
      <p class="eyebrow">Dashboard</p>
      <h1>评论审核与系统配置</h1>
      <p>D1 是主库，KV 与单实例内存用于公开评论缓存。下方清单逐项检查后台依赖的 Cloudflare 绑定与环境变量，缺少时只提示变量名和期望值，不会拦截访问或管理；真实配置仍在 Cloudflare Dashboard 中维护。</p>
    </section>
    <div class="admin-layout">
      <section class="admin-panel" aria-labelledby="health-title">
        <h2 id="health-title">环境变量与绑定检查（仅提醒）</h2>
        ${healthView()}
        <div class="admin-actions">
          <button class="btn" type="button" id="refreshButton" aria-label="刷新后台数据">刷新数据</button>
          <button class="btn" type="button" id="migrateButton" aria-label="从旧 KV 迁移评论到 D1" ${config.migrationEnabled ? "" : "disabled"}>迁移旧评论</button>
          <button class="btn" type="button" id="cleanupEventsButton" aria-label="清理 90 天前的统计事件">清理统计事件</button>
          <button class="btn" type="button" id="telegramTestButton" aria-label="发送一条 Telegram 通知测试">测试 Telegram</button>
        </div>
        <p class="admin-status" role="status">${esc(state.status)}</p>
      </section>

      <section class="admin-panel" aria-labelledby="config-title">
        <h2 id="config-title">系统配置</h2>
        <form class="admin-form" id="configForm">
          <label class="admin-toggle">
            <input name="commentsEnabled" type="checkbox" ${config.commentsEnabled !== false ? "checked" : ""}>
            <span>允许访客发布留言</span>
          </label>
          <label class="admin-toggle">
            <input name="moderationEnabled" type="checkbox" ${config.moderationEnabled !== false ? "checked" : ""}>
            <span>启用 Workers AI 审核</span>
          </label>
          <label class="admin-toggle">
            <input name="migrationEnabled" type="checkbox" ${config.migrationEnabled !== false ? "checked" : ""}>
            <span>允许后台执行旧 KV 迁移</span>
          </label>
          <label>
            <span>AI 审核模型</span>
            <input name="aiModel" value="${esc(config.aiModel || defaultAiModel)}" autocomplete="off">
          </label>
          <label>
            <span>AI 对话模型</span>
            <input name="aiChatModel" value="${esc(config.aiChatModel || defaultAiModel)}" autocomplete="off">
          </label>
          <label>
            <span>公开 Turnstile site key</span>
            <input name="turnstileSiteKey" value="${esc(config.turnstileSiteKey || "")}" autocomplete="off">
          </label>
          <label>
            <span>KV 公开评论缓存 TTL（秒，最小 60）</span>
            <input name="approvedCacheTtlSeconds" type="number" min="60" max="3600" value="${esc(config.approvedCacheTtlSeconds || 60)}">
          </label>
          <label>
            <span>Worker 内存缓存 TTL（秒）</span>
            <input name="memoryCacheTtlSeconds" type="number" min="1" max="300" value="${esc(config.memoryCacheTtlSeconds || 15)}">
          </label>
          ${localizedFieldset("title", "首页标题", config.title)}
          ${localizedFieldset("subtitle", "首页副标题", config.subtitle, "textarea")}
          ${localizedFieldset("documentTitle", "浏览器标题", config.documentTitle)}
          ${localizedFieldset("notice", "评论区公告", config.notice, "textarea", false)}
          <div class="admin-actions">
            <button class="btn btn--primary" type="submit">保存配置</button>
          </div>
          <p class="admin-status" id="configStatus" role="status">${esc(state.status)}</p>
        </form>
      </section>

      <section class="admin-panel admin-panel--chat" aria-labelledby="ai-chat-title">
        <div class="admin-comment-toolbar">
          <div>
            <h2 id="ai-chat-title">AI 数据对话</h2>
            <p>基于 D1 的评论与访问事件，只读回答访问量、热门页面、最近事件和审核状态。</p>
          </div>
        </div>
        <div class="admin-chat-log" id="adminChatLog" aria-live="polite">
          ${state.chatMessages.map(chatMessage).join("")}
          ${state.chatLoading ? '<p class="admin-chat-message admin-chat-message--assistant">正在查询 D1 并生成回复...</p>' : ""}
        </div>
        ${state.chatDataAt ? `<p class="admin-chat-meta">数据生成时间：${esc(formatTime(state.chatDataAt))} · 统计窗口：过去 24 小时 / 7 天 / 30 天</p>` : ""}
        <form class="admin-chat-form" id="aiChatForm">
          <label>
            <span>向 AI 提问</span>
            <input name="message" maxlength="1000" autocomplete="off" placeholder="例如：今天访问量多少？最近有哪些待审留言？热门页面是什么？">
          </label>
          <button class="btn btn--primary" type="submit" aria-label="发送 AI 对话问题">发送</button>
        </form>
      </section>

      <section class="admin-panel admin-panel--comments admin-panel--wide" aria-labelledby="comments-title">
        <div class="admin-comment-toolbar">
          <div>
            <h2 id="comments-title">留言管理</h2>
            <p>当前列表：${esc(statusLabel(state.statusFilter))}，共 ${state.comments.length} 条。</p>
          </div>
          <label>
            <span>状态筛选</span>
            <select id="statusFilter" aria-label="选择评论状态筛选">
              ${["pending", "approved", "rejected", "all"].map((status) => `<option value="${status}" ${state.statusFilter === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="admin-list" id="adminCommentList">
          ${state.comments.length ? state.comments.map(commentItem).join("") : '<p class="comment-list__empty">暂无匹配留言。</p>'}
        </div>
      </section>
    </div>
  `;
}

const envCheckGuide = {
  COMMENTS_DB: {
    kind: "D1 数据库绑定",
    badge: "必需",
    hint: "期望值：新建或选择 D1 数据库（如 about-comments），并把 database_id 配置到 Pages 项目；缺少时留言无法入库，留言审核与 AI 数据对话不可用。设置位置：Cloudflare Pages → Settings → Functions → D1 Database Bindings（变量名保持 COMMENTS_DB）。",
  },
  COMMENTS_KV: {
    kind: "KV 命名空间绑定",
    badge: "必需",
    hint: "期望值：KV namespace（绑定名 COMMENTS_KV），用于公开评论缓存与限流计数；缺少时公开评论读取与提交限流不可用。设置位置：Settings → Functions → KV Namespace Bindings。",
  },
  AI: {
    kind: "Workers AI 绑定",
    badge: "建议",
    hint: "期望值：创建 Workers AI binding（无需密钥，绑定名 AI）；缺少时留言自动进入待审、AI 数据对话不可用，但页面访问与后台管理不受影响。设置位置：Settings → Functions → Workers AI Bindings。",
  },
  ADMIN_PASSWORD: {
    kind: "管理员登录密码（Secret）",
    badge: "必需",
    hint: "期望值：你自己设置的管理员登录密码（建议足够长的随机串）。兼容变量名：ADMIN_SECRET、SFSY_ADMIN_PASSWORD、SITE_ADMIN_PASSWORD；或 Secrets Store 绑定 SECRETS / SECRET_STORE / ADMIN_SECRETS 中的同名密钥。缺少时无法登录后台，公开页面不受影响。设置位置：Settings → Functions → Environment Variables（Secret）。",
  },
  TURNSTILE_SECRET_KEY: {
    kind: "Turnstile 私钥（Secret）",
    badge: "必需",
    hint: "期望值：Turnstile 控制台对应站点的 Secret Key（0x 开头），与公开 site key 成对；缺少时访客发布留言会被拒绝，页面浏览不受影响。设置位置：Settings → Functions → Environment Variables（Secret）。",
  },
  TURNSTILE_SITE_KEY: {
    kind: "Turnstile 公钥（环境变量）",
    badge: "可选",
    hint: "期望值：Turnstile 控制台的 Site Key（0x 开头）。它只是环境变量级默认值，在后台「系统配置 → 公开 Turnstile site key」保存过时可以留空。设置位置：Settings → Functions → Environment Variables。",
  },
  TELEGRAM_BOT_TOKEN: {
    kind: "Telegram Bot Token（Secret）",
    badge: "可选",
    hint: "期望值：@BotFather 创建的 bot token，形如 1234567890:AAF…，用于新留言通知与「测试 Telegram」按钮。缺少时只有该通知功能不可用，其余留言流程正常。设置位置：Settings → Functions → Environment Variables（Secret）。",
  },
  TELEGRAM_CHAT_ID: {
    kind: "Telegram 接收 chat（Secret）",
    badge: "可选",
    hint: "期望值：站长自己的 chat id（先给 bot 发一句话，再用 getUpdates 查询），通常是一串数字或 @频道名，需与 TELEGRAM_BOT_TOKEN 成对设置。设置位置：Settings → Functions → Environment Variables（Secret）。",
  },
  COMMENT_MODERATION_MODEL: {
    kind: "AI 审核模型（环境变量）",
    badge: "可选",
    hint: "期望值：Workers AI 模型名，如 @cf/meta/llama-guard-3-8b。不设置时用内置默认模型，后台「系统配置 → AI 审核模型」保存后以此为准。设置位置：Settings → Functions → Environment Variables。",
  },
  AI_CHAT_MODEL: {
    kind: "AI 对话模型（环境变量）",
    badge: "可选",
    hint: "期望值：模型名，默认 @cf/meta/llama-3.2-3b-instruct；兼容旧名 ADMIN_AI_CHAT_MODEL。后台「AI 对话模型」已保存时可忽略此项。设置位置：Settings → Functions → Environment Variables。",
  },
  RUNTIME_SCHEMA_BOOTSTRAP: {
    kind: "运行时装表（环境变量）",
    badge: "可选",
    hint: "期望值：设为 1 时 Worker 首次启动会自动在 D1 建表；生产若已用 migrations/0001_comments_d1.sql 建过表则不必设置（本地 wrangler.jsonc 默认已有）。设置位置：Settings → Functions → Environment Variables。",
  },
};

function healthView() {
  const health = state.health || {};
  const checks = Array.isArray(health.checks) ? health.checks : [];
  return `
    <p>以下清单只做提醒、不拦截任何功能：缺少某项时页面访问、留言区和后台管理仍然可用，只是对应功能不可用。逐项查看变量名、期望值与设置位置即可。</p>
    <div class="admin-health admin-health--envs">
      ${checks.length
        ? checks.map(healthItem).join("")
        : '<p class="comment-list__empty">暂无环境变量状态数据，请点击「刷新数据」。</p>'}
    </div>
  `;
}

function healthItem(check) {
  const meta = envCheckGuide[check.name] || {};
  const ok = Boolean(check.ok);
  return `
    <div class="admin-health__item ${ok ? "is-ok" : "is-missing"}">
      <div class="admin-health__head">
        <strong><code>${esc(check.name)}</code></strong>
        <em class="admin-health__state">${ok ? "已配置" : "未配置"}</em>
      </div>
      <p class="admin-health__meta">${esc(meta.kind || "环境变量")}${meta.badge ? ` · ${esc(meta.badge)}` : ""}</p>
      ${ok ? "" : meta.hint ? `<p class="admin-health__hint">${esc(meta.hint)}</p>` : ""}
    </div>
  `;
}

function localizedFieldset(name, label, value = {}, type = "input", required = true) {
  const field = (lang, title) => {
    const val = value?.[lang] || "";
    if (type === "textarea") {
      return `
        <label>
          <span>${title}</span>
          <textarea name="${name}.${lang}" ${required ? "required" : ""}>${esc(val)}</textarea>
        </label>
      `;
    }
    return `
      <label>
        <span>${title}</span>
        <input name="${name}.${lang}" value="${esc(val)}" ${required ? "required" : ""}>
      </label>
    `;
  };

  return `
    <fieldset class="admin-fieldset">
      <legend>${esc(label)}</legend>
      ${field("zh", "中文")}
      ${field("ja", "日本語")}
      ${field("en", "English")}
    </fieldset>
  `;
}

function commentItem(comment) {
  const status = comment.status || "approved";
  return `
    <article class="admin-comment" data-id="${esc(comment.id)}">
      <div class="admin-comment__head">
        <div>
          <strong>${esc(comment.name || "Anonymous")}</strong>
          <span class="admin-badge admin-badge--${esc(status)}">${esc(statusLabel(status))}</span>
        </div>
        <div class="admin-actions">
          ${status !== "approved" ? `<button class="btn btn--primary js-review-comment" type="button" data-status="approved" data-id="${esc(comment.id)}" aria-label="批准 ${esc(comment.name || "Anonymous")} 的留言">批准</button>` : ""}
          ${status !== "rejected" ? `<button class="btn js-review-comment" type="button" data-status="rejected" data-id="${esc(comment.id)}" aria-label="驳回 ${esc(comment.name || "Anonymous")} 的留言">驳回</button>` : ""}
          <button class="btn btn--danger js-delete-comment" type="button" data-id="${esc(comment.id)}" aria-label="删除 ${esc(comment.name || "Anonymous")} 的留言">删除</button>
        </div>
      </div>
      <p>${esc(comment.message || "")}</p>
      <div class="admin-comment__meta">
        <small>${esc(formatTime(comment.createdAt))}</small>
        <small>IP: ${esc(comment.ip || "unknown")} · 归属地: ${esc(commentLocation(comment))}</small>
      </div>
      ${comment.moderationReason || comment.moderationError || comment.moderationCategories ? `
        <details class="admin-moderation">
          <summary>AI 审核记录</summary>
          <dl>
            <dt>模型</dt><dd>${esc(comment.moderationModel || "")}</dd>
            <dt>类别</dt><dd>${esc(comment.moderationCategories || "无")}</dd>
            <dt>原因</dt><dd>${esc(comment.moderationReason || "无")}</dd>
            <dt>错误</dt><dd>${esc(comment.moderationError || "无")}</dd>
          </dl>
        </details>
      ` : ""}
    </article>
  `;
}

function chatMessage(item) {
  const role = item.role === "user" ? "user" : "assistant";
  return `
    <p class="admin-chat-message admin-chat-message--${role}">
      <strong>${role === "user" ? "你" : "AI"}</strong>
      <span>${esc(item.content || "")}</span>
    </p>
  `;
}

function statusLabel(status) {
  return {
    pending: "待审核",
    approved: "已公开",
    rejected: "已驳回",
    all: "全部",
  }[status] || status;
}

function commentLocation(comment) {
  const value = String(comment.ipLocation || comment.location || "").trim();
  return !value || value.toLowerCase() === "unknown location" ? "未知归属地" : value;
}

function formatTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function bind() {
  document.getElementById("loginForm")?.addEventListener("submit", login);
  document.getElementById("configForm")?.addEventListener("submit", saveConfig);
  document.getElementById("refreshButton")?.addEventListener("click", loadDashboard);
  document.getElementById("migrateButton")?.addEventListener("click", migrateComments);
  document.getElementById("cleanupEventsButton")?.addEventListener("click", cleanupEvents);
  document.getElementById("telegramTestButton")?.addEventListener("click", testTelegram);
  document.getElementById("logoutButton")?.addEventListener("click", logout);
  document.getElementById("aiChatForm")?.addEventListener("submit", sendAiChat);
  document.getElementById("statusFilter")?.addEventListener("change", (event) => {
    state.statusFilter = event.currentTarget.value;
    loadDashboard();
  });
  document.querySelectorAll(".js-review-comment").forEach((button) => {
    button.addEventListener("click", () => updateCommentStatus(button.dataset.id, button.dataset.status));
  });
  document.querySelectorAll(".js-delete-comment").forEach((button) => {
    button.addEventListener("click", () => deleteComment(button.dataset.id));
  });
}

async function login(event) {
  event.preventDefault();
  const status = document.getElementById("loginStatus");
  const password = new FormData(event.currentTarget).get("password");
  if (status) status.textContent = "正在登录...";

  try {
    const response = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    if (!response.ok) throw new Error(await responseText(response));
    state.authed = true;
    state.status = "已登录。";
    await loadDashboard();
  } catch (error) {
    if (status) status.textContent = error.message || "登录失败。";
  }
}

async function logout() {
  await api("/api/admin/logout", { method: "POST" }).catch(() => {});
  state.authed = false;
  state.config = emptyConfig;
  state.comments = [];
  state.health = null;
  state.status = "已退出。";
  render();
}

async function saveConfig(event) {
  event.preventDefault();
  const status = document.getElementById("configStatus");
  if (status) status.textContent = "正在保存...";
  const payload = configFromForm(new FormData(event.currentTarget));

  try {
    const response = await api("/api/admin/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await responseText(response));
    const data = await response.json();
    state.config = data.config || data.settings || emptyConfig;
    state.status = "配置已保存，公开评论缓存已刷新。";
    render();
  } catch (error) {
    if (status) status.textContent = error.message || "保存失败。";
  }
}

function configFromForm(form) {
  const pick = (name) => ({
    zh: String(form.get(`${name}.zh`) || "").trim(),
    ja: String(form.get(`${name}.ja`) || "").trim(),
    en: String(form.get(`${name}.en`) || "").trim(),
  });
  return {
    commentsEnabled: form.get("commentsEnabled") === "on",
    moderationEnabled: form.get("moderationEnabled") === "on",
    migrationEnabled: form.get("migrationEnabled") === "on",
    aiModel: String(form.get("aiModel") || "").trim(),
    aiChatModel: String(form.get("aiChatModel") || "").trim(),
    turnstileSiteKey: String(form.get("turnstileSiteKey") || "").trim(),
    approvedCacheTtlSeconds: Number.parseInt(form.get("approvedCacheTtlSeconds") || "60", 10),
    memoryCacheTtlSeconds: Number.parseInt(form.get("memoryCacheTtlSeconds") || "15", 10),
    title: pick("title"),
    subtitle: pick("subtitle"),
    documentTitle: pick("documentTitle"),
    notice: pick("notice"),
  };
}

async function updateCommentStatus(id, status) {
  if (!id || !status) return;
  state.status = "正在更新留言状态...";
  render();
  try {
    const response = await api(`/api/admin/comments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error(await responseText(response));
    state.status = `留言已更新为${statusLabel(status)}。`;
    await loadDashboard();
  } catch (error) {
    state.status = error.message || "更新失败。";
    render();
  }
}

async function deleteComment(id) {
  if (!id) return;
  const button = document.querySelector(`.js-delete-comment[data-id="${CSS.escape(id)}"]`);
  if (button) button.disabled = true;

  try {
    const response = await api(`/api/admin/comments/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await responseText(response));
    state.status = "留言已删除，公开评论缓存已刷新。";
    await loadDashboard();
  } catch (error) {
    state.status = error.message || "删除失败。";
    render();
  }
}

async function migrateComments() {
  state.status = "正在迁移旧 KV 留言...";
  render();
  try {
    const response = await api("/api/admin/migrate-comments", { method: "POST" });
    if (!response.ok) throw new Error(await responseText(response));
    const data = await response.json();
    const result = data.result || {};
    state.status = `迁移完成：导入 ${result.imported || 0} 条，跳过 ${result.skipped || 0} 条。`;
    state.statusFilter = "all";
    await loadDashboard();
  } catch (error) {
    state.status = error.message || "迁移失败。";
    render();
  }
}

async function cleanupEvents() {
  if (!window.confirm("将删除 90 天前的 site_events 统计事件（后台接口支持 7~365 天）。确定继续吗？")) return;
  const button = document.getElementById("cleanupEventsButton");
  if (button) button.disabled = true;
  state.status = "正在清理过期统计事件...";
  render();
  try {
    const response = await api("/api/admin/cleanup-events", {
      method: "POST",
      body: JSON.stringify({ days: 90 }),
    });
    if (!response.ok) throw new Error(await responseText(response));
    const data = await response.json();
    state.status = `统计事件已清理：删除 ${data.deleted ?? 0} 条（早于 ${data.cutoff || "90 天前"}）。`;
    render();
  } catch (error) {
    state.status = error.message || "清理失败。";
    render();
  } finally {
    if (button) button.disabled = false;
  }
}

async function testTelegram() {
  if (!window.confirm("将向配置的 Telegram 聊天发送一条测试通知。确定继续吗？")) return;
  const button = document.getElementById("telegramTestButton");
  if (button) button.disabled = true;
  state.status = "正在发送 Telegram 测试通知...";
  render();
  try {
    const response = await api("/api/admin/test-telegram", { method: "POST", body: JSON.stringify({}) });
    if (!response.ok) throw new Error(await responseText(response));
    state.status = "Telegram 测试通知已发送，请查看聊天。";
    render();
  } catch (error) {
    state.status = error.message || "Telegram 测试失败。";
    render();
  } finally {
    if (button) button.disabled = false;
  }
}

async function sendAiChat(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.elements.message;
  const message = String(input?.value || "").trim();
  if (!message || state.chatLoading) return;

  state.chatMessages.push({ role: "user", content: message });
  state.chatLoading = true;
  input.value = "";
  render();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_CHAT_TIMEOUT_MS);
  try {
    const response = await api("/api/admin/ai-chat", {
      method: "POST",
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await responseText(response));
    const data = await response.json();
    state.chatMessages.push({ role: "assistant", content: data.reply || "没有得到回复。" });
    if (data.contextMeta?.generatedAt) state.chatDataAt = String(data.contextMeta.generatedAt);
  } catch (error) {
    if (controller.signal.aborted) {
      state.chatMessages.push({
        role: "assistant",
        content: `查询超时（超过 ${Math.round(AI_CHAT_TIMEOUT_MS / 1000)} 秒未收到回复）。请稍后重试；若总是超时，可在「系统配置 → AI 对话模型」换用更快的模型。`,
      });
    } else {
      state.chatMessages.push({
        role: "assistant",
        content: error.message || "AI 对话暂时不可用。",
      });
    }
  } finally {
    clearTimeout(timeoutId);
    state.chatLoading = false;
    render();
    document.getElementById("adminChatLog")?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }
}

async function loadDashboard() {
  state.loading = true;
  render();
  try {
    const [configResponse, commentsResponse, healthResponse] = await Promise.all([
      api("/api/admin/config"),
      api(`/api/admin/comments?limit=100&status=${encodeURIComponent(state.statusFilter)}`),
      api("/api/admin/health"),
    ]);
    if (!configResponse.ok) throw await apiError(configResponse);
    if (!commentsResponse.ok) throw await apiError(commentsResponse);
    if (!healthResponse.ok) throw await apiError(healthResponse);
    const configData = await configResponse.json();
    const commentsData = await commentsResponse.json();
    const healthData = await healthResponse.json();
    state.authed = true;
    state.config = configData.config || configData.settings || emptyConfig;
    state.comments = Array.isArray(commentsData.comments) ? commentsData.comments : [];
    state.health = healthData.health || null;
    state.loading = false;
    render();
  } catch (error) {
    state.loading = false;
    state.status = error.message || "加载失败，请点击「刷新数据」重试。";
    if (error.status === 401 || error.status === 403) {
      state.authed = false;
      state.health = null;
    }
    render();
  }
}

async function apiError(response) {
  const error = new Error(await responseText(response));
  error.status = response.status;
  return error;
}

async function responseText(response) {
  const data = await response.json().catch(() => ({}));
  return data.error || `HTTP ${response.status}`;
}

async function init() {
  try {
    const response = await api("/api/admin/me");
    if (response.ok) {
      state.authed = true;
      await loadDashboard();
      return;
    }
  } catch {
    // Render the login form below.
  }
  state.loading = false;
  render();
}

init();
