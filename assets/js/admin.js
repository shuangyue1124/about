import { cities } from "./data.js";

const app = document.getElementById("adminApp");
const defaultAiModel = "@cf/meta/llama-3.2-3b-instruct";

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
  profiles: [],
  editingProfile: null,
  editingContent: null,
  contactsCatalog: [],
  contentItems: [],
  contentFilter: "all",
  githubUsername: "shuangyue1124",
  githubCandidates: [],
  citySearch: "",
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
          <img src="assets/images/avatar.webp" alt="朔风霜月头像" loading="lazy">
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
      <p>D1 是主库，KV 与单实例内存用于公开评论缓存。Cloudflare 绑定和 secret 只做健康检查，真实配置仍在 Wrangler 或 Cloudflare Dashboard 中维护。</p>
    </section>
    <div class="admin-layout">
      <section class="admin-panel" aria-labelledby="health-title">
        <h2 id="health-title">绑定健康检查</h2>
        ${healthView()}
        <div class="admin-actions">
          <button class="btn" type="button" id="refreshButton" aria-label="刷新后台数据">刷新数据</button>
          <button class="btn" type="button" id="migrateButton" aria-label="从旧 KV 迁移评论到 D1" ${config.migrationEnabled ? "" : "disabled"}>迁移旧评论</button>
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

      <section class="admin-panel admin-panel--wide" aria-labelledby="profiles-title">
        <div class="admin-comment-toolbar">
          <div>
            <h2 id="profiles-title">域名 / 页面管理</h2>
            <p>同一 Pages 项目按 hostname 选择 Profile；一次公开请求只返回当前域名的允许数据。</p>
          </div>
          <div class="admin-actions">
            <button class="btn btn--primary" type="button" id="newProfileButton">新增域名</button>
          </div>
        </div>
        <div class="admin-list">
          ${state.profiles.length ? state.profiles.map(profileRow).join("") : '<p class="comment-list__empty">暂无域名配置（将使用内置默认）。</p>'}
        </div>
        ${state.editingProfile ? profileEditor(state.editingProfile) : ""}
      </section>

      <section class="admin-panel admin-panel--wide" aria-labelledby="content-title">
        <div class="admin-comment-toolbar">
          <div>
            <h2 id="content-title">内容管理（动漫 / 游戏 / GitHub 共用 content_items）</h2>
            <p>三语缺失会自动 fallback；禁用后前台不再出现。</p>
          </div>
          <label>
            <span>类型筛选</span>
            <select id="contentFilter">
              ${["all", "anime", "game", "github", "project"].map((t) => `<option value="${t}" ${state.contentFilter === t ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="admin-list">
          ${state.contentItems.length ? state.contentItems.map(contentRow).join("") : '<p class="comment-list__empty">暂无内容，可手动添加或从 GitHub 导入。</p>'}
        </div>
        <form class="admin-form" id="contentForm">
          <h3>手动添加 / 编辑项目</h3>
          <input name="id" type="hidden" value="${esc(state.editingContent?.id || "")}">
          <label><span>类型（anime / game / github / project）</span><input name="type" value="${esc(state.editingContent?.type || "github")}"></label>
          <label><span>Slug</span><input name="slug" value="${esc(state.editingContent?.slug || "")}" placeholder="my-project"></label>
          <label><span>标题（中文）</span><input name="title_zh" value="${esc(state.editingContent?.title?.zh || "")}"></label>
          <label><span>标题（日文）</span><input name="title_ja" value="${esc(state.editingContent?.title?.ja || "")}"></label>
          <label><span>标题（英文）</span><input name="title_en" value="${esc(state.editingContent?.title?.en || "")}"></label>
          <label><span>简介（中文）</span><textarea name="summary_zh">${esc(state.editingContent?.summary?.zh || "")}</textarea></label>
          <label><span>简介（日文）</span><textarea name="summary_ja">${esc(state.editingContent?.summary?.ja || "")}</textarea></label>
          <label><span>简介（英文）</span><textarea name="summary_en">${esc(state.editingContent?.summary?.en || "")}</textarea></label>
          <label><span>链接 URL</span><input name="url" value="${esc(state.editingContent?.url || "")}"></label>
          <label><span>封面</span><input name="cover" value="${esc(state.editingContent?.cover || "")}"></label>
          <label><span>排序</span><input name="sortOrder" type="number" value="${esc(state.editingContent?.sortOrder ?? 0)}"></label>
          <label class="admin-toggle"><input name="enabled" type="checkbox" ${state.editingContent?.enabled !== false ? "checked" : ""}><span>启用</span></label>
          <div class="admin-actions"><button class="btn btn--primary" type="submit">保存项目</button></div>
        </form>
        <form class="admin-form" id="githubScanForm">
          <h3>GitHub 自动扫描</h3>
          <label><span>GitHub 用户名</span><input name="username" value="${esc(state.githubUsername)}"></label>
          <div class="admin-actions"><button class="btn" type="submit">扫描 GitHub</button></div>
        </form>
        ${state.githubCandidates.length ? `
        <div class="admin-list">
          ${state.githubCandidates.map((r, i) => `
            <article class="admin-comment">
              <div class="admin-comment__head">
                <div><strong>${esc(r.name)}</strong><span> ★${esc(r.stargazers_count)} · ${esc(r.language || "")}</span></div>
                <label class="admin-toggle"><input type="checkbox" data-github-pick="${i}" checked><span>展示</span></label>
              </div>
              <p>${esc(r.description || "")}</p>
              <small>${esc(r.html_url)}</small>
            </article>`).join("")}
        </div>
        <div class="admin-actions"><button class="btn btn--primary" type="button" id="githubImportButton">导入选中仓库</button></div>` : ""}
      </section>
    </div>
  `;
}

const MODULE_LABELS = { profile: "个人资料", about: "关于", contacts: "联系方式", travel: "旅行", anime: "动漫", games: "游戏", github: "GitHub", comments: "评论" };
const CONTACT_LABELS = { wechat: "微信", qq: "QQ", telegram: "Telegram", github: "GitHub", email: "Email", steam: "Steam", minecraft: "Minecraft", genshin: "原神", website: "网站", bilibili: "B站", x: "X", instagram: "Instagram", discord: "Discord", custom: "自定义" };

function profileRow(p) {
  return `
    <article class="admin-comment" data-hostname="${esc(p.hostname)}">
      <div class="admin-comment__head">
        <div><strong>${esc(p.hostname)}</strong><span class="admin-badge admin-badge--${p.enabled ? "approved" : "rejected"}">${esc(p.enabled ? "启用" : "禁用")}</span>
        <span>模板 ${esc(p.template)} · 语言 ${esc(p.language)} · 模块 ${(p.modules || []).length} · 联系 ${(p.contacts || []).length} · 旅行 ${esc(p.travel?.mode)}</span></div>
        <div class="admin-actions">
          <button class="btn js-edit-profile" type="button" data-hostname="${esc(p.hostname)}">编辑</button>
          <button class="btn btn--danger js-delete-profile" type="button" data-hostname="${esc(p.hostname)}">删除</button>
        </div>
      </div>
    </article>`;
}

function profileEditor(p) {
  const q = (state.citySearch || "").toLowerCase();
  const list = cities.filter((c) => {
    if (!q) return true;
    const hay = `${c.slug} ${c.name?.zh || ""} ${c.name?.ja || ""} ${c.name?.en || ""} ${c.region?.zh || ""}`.toLowerCase();
    return hay.includes(q);
  });
  const selected = new Set((p.travel?.cities || []).map((s) => String(s).toLowerCase()));
  return `
    <form class="admin-form" id="profileForm">
      <h3>编辑 ${esc(p.hostname || "新域名")}</h3>
      <label><span>域名 hostname</span><input name="hostname" value="${esc(p.hostname || "")}" placeholder="wx.shuangyue.space"></label>
      <label><span>页面名称（可空，三语标题覆盖在下方）</span><input name="githubUser" value="${esc(p.githubUser || "")}" placeholder="shuangyue1124"></label>
      <label><span>模板</span><select name="template">${["full", "contact", "social", "travel", "projects", "minimal", "custom"].map((t) => `<option value="${t}" ${p.template === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label><span>语言</span><select name="language">${[["auto", "自动"], ["zh", "中文"], ["ja", "日文"], ["en", "英文"]].map(([v, l]) => `<option value="${v}" ${p.language === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="admin-toggle"><input name="enabled" type="checkbox" ${p.enabled !== false ? "checked" : ""}><span>启用该域名</span></label>
      <fieldset class="admin-fieldset"><legend>页面模块</legend>
        ${Object.entries(MODULE_LABELS).map(([id, name]) => `<label class="admin-toggle"><input name="module_${id}" type="checkbox" ${(p.modules || []).includes(id) ? "checked" : ""}><span>${name}</span></label>`).join("")}
      </fieldset>
      <fieldset class="admin-fieldset"><legend>联系方式（公开 API 只返回勾选项）</legend>
        ${Object.entries(CONTACT_LABELS).map(([id, name]) => `<label class="admin-toggle"><input name="contact_${id}" type="checkbox" ${(p.contacts || []).includes(id) ? "checked" : ""}><span>${name}</span></label>`).join("")}
      </fieldset>
      <fieldset class="admin-fieldset"><legend>旅行足迹</legend>
        ${[["disabled", "不开放"], ["all", "全部开放"], ["include", "仅展示所选"], ["exclude", "屏蔽所选"]].map(([v, l]) => `<label class="admin-toggle"><input name="travelMode" type="radio" value="${v}" ${p.travel?.mode === v ? "checked" : ""}><span>${l}</span></label>`).join("")}
        <div class="admin-actions">
          <button class="btn" type="button" id="citySelectAll">全选</button>
          <button class="btn" type="button" id="cityInvert">反选</button>
          <button class="btn" type="button" id="cityClear">清空</button>
        </div>
        <label><span>搜索城市</span><input id="citySearch" value="${esc(state.citySearch || "")}" placeholder="搜索城市、省份、slug"></label>
        <div class="admin-list" style="max-height:240px;overflow:auto">
          ${list.map((c) => `<label class="admin-toggle"><input name="city_${c.slug}" type="checkbox" ${selected.has(c.slug) ? "checked" : ""}><span>${esc(c.name?.zh || c.slug)} (${esc(c.slug)})</span></label>`).join("")}
          <label class="admin-toggle"><input name="city_japan-2026" type="checkbox" ${selected.has("japan-2026") ? "checked" : ""}><span>日本旅记 (japan-2026)</span></label>
        </div>
      </fieldset>
      <div class="admin-actions">
        <button class="btn btn--primary" type="submit">保存域名配置</button>
        <button class="btn" type="button" id="cancelProfileEdit">取消</button>
      </div>
    </form>`;
}

function contentRow(item) {
  const title = item.title?.zh || item.slug;
  return `
    <article class="admin-comment" data-id="${esc(item.id)}">
      <div class="admin-comment__head">
        <div><strong>[${esc(item.type)}] ${esc(title)}</strong><span class="admin-badge admin-badge--${item.enabled ? "approved" : "rejected"}">${esc(item.enabled ? "启用" : "禁用")}</span><span> ${esc(item.slug)} · sort ${esc(item.sortOrder)}</span></div>
        <div class="admin-actions">
          <button class="btn js-edit-content" type="button" data-id="${esc(item.id)}">编辑</button>
          ${item.enabled
            ? `<button class="btn js-hide-content" type="button" data-id="${esc(item.id)}">隐藏</button>`
            : `<button class="btn btn--primary js-show-content" type="button" data-id="${esc(item.id)}">显示</button>`}
          <button class="btn js-ai-review" type="button" data-id="${esc(item.id)}">生成 AI 短评</button>
          <button class="btn btn--danger js-delete-content" type="button" data-id="${esc(item.id)}">永久删除</button>
        </div>
      </div>
      <p>${esc(item.summary?.zh || "")}</p>
      ${item.metadata?.review?.zh ? `<p><strong>AI 短评：</strong>${esc(item.metadata.review.zh)}</p>` : ""}
    </article>`;
}

function healthView() {
  const health = state.health || {};
  const items = [
    ["COMMENTS_DB / D1", health.d1],
    ["COMMENTS_KV / KV", health.kv],
    ["AI binding", health.ai],
    ["TURNSTILE_SECRET_KEY", health.turnstileSecret],
    ["ADMIN_PASSWORD", health.adminPassword],
  ];
  return `
    <div class="admin-health">
      ${items.map(([label, ok]) => `
        <span class="admin-health__item ${ok ? "is-ok" : "is-missing"}">
          <strong>${esc(label)}</strong>
          <em>${ok ? "已配置" : "未配置"}</em>
        </span>
      `).join("")}
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
  document.getElementById("newProfileButton")?.addEventListener("click", () => {
    state.editingProfile = { hostname: "", enabled: true, template: "contact", language: "auto", modules: ["profile", "contacts"], contacts: ["wechat", "qq"], travel: { mode: "disabled", cities: [] }, githubUser: "shuangyue1124" };
    render();
  });
  document.getElementById("cancelProfileEdit")?.addEventListener("click", () => {
    state.editingProfile = null;
    render();
  });
  document.querySelectorAll(".js-edit-profile").forEach((b) => b.addEventListener("click", () => {
    state.editingProfile = state.profiles.find((p) => p.hostname === b.dataset.hostname) || null;
    render();
  }));
  document.querySelectorAll(".js-delete-profile").forEach((b) => b.addEventListener("click", () => deleteProfile(b.dataset.hostname)));
  document.getElementById("profileForm")?.addEventListener("submit", saveProfile);
  document.getElementById("citySearch")?.addEventListener("input", (e) => {
    state.citySearch = e.currentTarget.value;
    render();
  });
  document.getElementById("citySelectAll")?.addEventListener("click", () => setAllCities(true));
  document.getElementById("cityInvert")?.addEventListener("click", invertCities);
  document.getElementById("cityClear")?.addEventListener("click", () => setAllCities(false));
  document.getElementById("contentFilter")?.addEventListener("change", (e) => {
    state.contentFilter = e.currentTarget.value;
    loadDashboard();
  });
  document.getElementById("contentForm")?.addEventListener("submit", saveContent);
  document.querySelectorAll(".js-edit-content").forEach((b) => b.addEventListener("click", () => {
    state.editingContent = state.contentItems.find((i) => i.id === b.dataset.id) || null;
    render();
  }));
  document.querySelectorAll(".js-delete-content").forEach((b) => b.addEventListener("click", () => {
    if (window.confirm("永久删除后无法恢复。确定吗？")) deleteContent(b.dataset.id, true);
  }));
  document.querySelectorAll(".js-hide-content").forEach((b) => b.addEventListener("click", () => deleteContent(b.dataset.id, false)));
  document.querySelectorAll(".js-show-content").forEach((b) => b.addEventListener("click", () => setContentVisibility(b.dataset.id, true)));
  document.querySelectorAll(".js-ai-review").forEach((b) => b.addEventListener("click", () => aiReview(b.dataset.id)));
  document.getElementById("githubScanForm")?.addEventListener("submit", scanGithub);
  document.getElementById("githubImportButton")?.addEventListener("click", importGithub);
}

function setAllCities(on) {
  const boxes = document.querySelectorAll('#profileForm input[name^="city_"]');
  boxes.forEach((b) => { b.checked = on; });
}
function invertCities() {
  const boxes = document.querySelectorAll('#profileForm input[name^="city_"]');
  boxes.forEach((b) => { b.checked = !b.checked; });
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

  try {
    const response = await api("/api/admin/ai-chat", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    if (!response.ok) throw new Error(await responseText(response));
    const data = await response.json();
    state.chatMessages.push({ role: "assistant", content: data.reply || "没有得到回复。" });
  } catch (error) {
    state.chatMessages.push({ role: "assistant", content: error.message || "AI 对话暂时不可用。" });
  } finally {
    state.chatLoading = false;
    render();
    document.getElementById("adminChatLog")?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }
}

async function loadDashboard() {
  state.loading = true;
  render();
  try {
    const [configResponse, commentsResponse, healthResponse, profilesResponse, contentResponse] = await Promise.all([
      api("/api/admin/config"),
      api(`/api/admin/comments?limit=100&status=${encodeURIComponent(state.statusFilter)}`),
      api("/api/admin/health"),
      api("/api/admin/profiles").catch(() => null),
      api(`/api/admin/content?type=${encodeURIComponent(state.contentFilter)}&all=1`).catch(() => null),
    ]);
    if (!configResponse.ok) throw new Error(await responseText(configResponse));
    if (!commentsResponse.ok) throw new Error(await responseText(commentsResponse));
    if (!healthResponse.ok) throw new Error(await responseText(healthResponse));
    const configData = await configResponse.json();
    const commentsData = await commentsResponse.json();
    const healthData = await healthResponse.json();
    state.authed = true;
    state.config = configData.config || configData.settings || emptyConfig;
    state.comments = Array.isArray(commentsData.comments) ? commentsData.comments : [];
    state.health = healthData.health || null;
    try {
      if (profilesResponse?.ok) {
        const pd = await profilesResponse.json();
        state.profiles = Array.isArray(pd.profiles) ? pd.profiles : [];
      }
    } catch { /* profiles optional before migration */ }
    try {
      if (contentResponse?.ok) {
        const cd = await contentResponse.json();
        state.contentItems = Array.isArray(cd.items) ? cd.items : [];
      }
    } catch { /* content optional */ }
    state.loading = false;
    render();
  } catch (error) {
    state.authed = false;
    state.loading = false;
    state.status = error.message || "需要重新登录。";
    render();
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const modules = Object.keys(MODULE_LABELS).filter((id) => form.get(`module_${id}`) === "on");
  const contacts = Object.keys(CONTACT_LABELS).filter((id) => form.get(`contact_${id}`) === "on");
  const travelCities = [...form.keys()].filter((k) => k.startsWith("city_") && form.get(k) === "on").map((k) => k.slice(5));
  const payload = {
    hostname: String(form.get("hostname") || "").trim().toLowerCase(),
    enabled: form.get("enabled") === "on",
    template: String(form.get("template") || "full"),
    language: String(form.get("language") || "auto"),
    modules, contacts,
    travel: { mode: String(form.get("travelMode") || "all"), cities: travelCities },
    githubUser: String(form.get("githubUser") || "shuangyue1124"),
  };
  if (!payload.hostname) { state.status = "请填写域名。"; render(); return; }
  try {
    const isNew = !state.profiles.some((p) => p.hostname === payload.hostname);
    const res = await api(isNew ? "/api/admin/profiles" : `/api/admin/profiles/${encodeURIComponent(payload.hostname)}`, {
      method: isNew ? "POST" : "PUT",
      body: JSON.stringify({ profile: payload }),
    });
    if (!res.ok) throw new Error(await responseText(res));
    state.status = "域名配置已保存，60 秒内生效。";
    state.editingProfile = null;
    await loadDashboard();
  } catch (error) {
    state.status = error.message || "保存失败。";
    render();
  }
}

async function deleteProfile(hostname) {
  try {
    const res = await api(`/api/admin/profiles/${encodeURIComponent(hostname)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await responseText(res));
    state.status = `已删除 ${hostname}（回退到内置默认）。`;
    await loadDashboard();
  } catch (error) {
    state.status = error.message || "删除失败。";
    render();
  }
}

async function saveContent(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    id: String(form.get("id") || "") || undefined,
    type: String(form.get("type") || "github"),
    slug: String(form.get("slug") || ""),
    title: { zh: String(form.get("title_zh") || ""), ja: String(form.get("title_ja") || ""), en: String(form.get("title_en") || "") },
    summary: { zh: String(form.get("summary_zh") || ""), ja: String(form.get("summary_ja") || ""), en: String(form.get("summary_en") || "") },
    url: String(form.get("url") || ""),
    cover: String(form.get("cover") || ""),
    sortOrder: Number(form.get("sortOrder") || 0),
    enabled: form.get("enabled") === "on",
  };
  // Fallback: empty ja/en reuse zh so frontend never shows blank.
  for (const k of ["title", "summary"]) {
    payload[k].ja = payload[k].ja || payload[k].zh;
    payload[k].en = payload[k].en || payload[k].zh;
  }
  try {
    const res = await api(payload.id ? `/api/admin/content/${encodeURIComponent(payload.id)}` : "/api/admin/content", {
      method: payload.id ? "PUT" : "POST",
      body: JSON.stringify({ item: payload }),
    });
    if (!res.ok) throw new Error(await responseText(res));
    state.status = "内容已保存。";
    state.editingContent = null;
    await loadDashboard();
  } catch (error) {
    state.status = error.message || "保存失败。";
    render();
  }
}

async function deleteContent(id, permanent = false) {
  try {
    const res = await api(`/api/admin/content/${encodeURIComponent(id)}${permanent ? "?permanent=1" : ""}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await responseText(res));
    state.status = permanent ? "内容已永久删除。" : "内容已隐藏，可随时恢复显示。";
    await loadDashboard();
  } catch (error) {
    state.status = error.message || "删除失败。";
    render();
  }
}

async function setContentVisibility(id, enabled) {
  // Show/hide reuses the content save path (enabled flag only).
  const item = state.contentItems.find((i) => i.id === id);
  if (!item) return;
  try {
    const res = await api(`/api/admin/content/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ item: { ...item, enabled } }),
    });
    if (!res.ok) throw new Error(await responseText(res));
    state.status = enabled ? "内容已恢复显示。" : "内容已隐藏。";
    await loadDashboard();
  } catch (error) {
    state.status = error.message || "更新失败。";
    render();
  }
}

async function scanGithub(event) {
  event.preventDefault();
  const username = String(new FormData(event.currentTarget).get("username") || "").trim() || "shuangyue1124";
  state.githubUsername = username;
  state.status = "正在扫描 GitHub…";
  render();
  try {
    const res = await api("/api/admin/github/scan", { method: "POST", body: JSON.stringify({ username }) });
    if (!res.ok) throw new Error(await responseText(res));
    const data = await res.json();
    state.githubCandidates = Array.isArray(data.repos) ? data.repos : [];
    state.status = `扫描完成：${state.githubCandidates.length} 个候选仓库，勾选后导入。`;
    render();
  } catch (error) {
    state.status = error.message || "扫描失败，页面仍可正常使用。";
    render();
  }
}

async function importGithub() {
  const picks = [...document.querySelectorAll("[data-github-pick]:checked")].map((el) => state.githubCandidates[Number(el.dataset.githubPick)]).filter(Boolean);
  if (!picks.length) { state.status = "请先勾选要导入的仓库。"; render(); return; }
  try {
    const res = await api("/api/admin/github/import", { method: "POST", body: JSON.stringify({ repos: picks }) });
    if (!res.ok) throw new Error(await responseText(res));
    const data = await res.json().catch(() => ({}));
    const deduped = Number(data.deduped) || 0;
    const fresh = picks.length - deduped;
    state.status = `导入完成：新增 ${fresh} 个${deduped ? `，${deduped} 个已存在并同步更新（未覆盖手动短评与排序）` : ""}。`;
    state.githubCandidates = [];
    await loadDashboard();
  } catch (error) {
    state.status = error.message || "导入失败。";
    render();
  }
}

async function aiReview(id) {
  state.status = "正在调用 Workers AI 生成三语短评（失败不影响已保存内容）…";
  render();
  try {
    const item = state.contentItems.find((i) => i.id === id);
    const res = await api("/api/admin/ai-review", { method: "POST", body: JSON.stringify({ id, repo: { name: item?.title?.zh, description: item?.summary?.zh, language: item?.metadata?.language }, overwrite: false }) });
    if (!res.ok) throw new Error(await responseText(res));
    state.status = "AI 短评已生成并保存，可继续手动修改。";
    await loadDashboard();
  } catch (error) {
    state.status = error.message || "AI 生成失败，已保留原内容。";
    render();
  }
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
