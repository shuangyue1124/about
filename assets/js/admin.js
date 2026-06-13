const app = document.getElementById("adminApp");

const emptySettings = {
  commentsEnabled: true,
  title: { zh: "", ja: "", en: "" },
  subtitle: { zh: "", ja: "", en: "" },
  documentTitle: { zh: "", ja: "", en: "" },
  notice: { zh: "", ja: "", en: "" },
};

const state = {
  authed: false,
  loading: true,
  settings: emptySettings,
  comments: [],
  status: "",
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
          <img src="https://q1.qlogo.cn/g?b=qq&nk=1970259391&s=640" alt="" loading="lazy">
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
        <p>管理后台只在设置了 Cloudflare 环境变量 ADMIN_PASSWORD 后启用。</p>
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
      <p>输入环境变量 <code>ADMIN_PASSWORD</code> 中配置的管理员密码。登录后可删除留言、开启或关闭留言、修改首页标题与副标题。</p>
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
  const settings = state.settings || emptySettings;
  return `
    <section class="admin-hero">
      <p class="eyebrow">Dashboard</p>
      <h1>站点控制台</h1>
      <p>设置会保存到 Cloudflare KV。评论关闭后，访客仍可查看旧留言，但不能发布新留言。</p>
    </section>
    <div class="admin-layout">
      <section class="admin-panel" aria-labelledby="settings-title">
        <h2 id="settings-title">站点设置</h2>
        <form class="admin-form" id="settingsForm">
          <label class="admin-toggle">
            <input name="commentsEnabled" type="checkbox" ${settings.commentsEnabled !== false ? "checked" : ""}>
            <span>允许访客发布留言</span>
          </label>
          ${localizedFieldset("title", "首页标题", settings.title)}
          ${localizedFieldset("subtitle", "首页副标题", settings.subtitle, "textarea")}
          ${localizedFieldset("documentTitle", "浏览器标题", settings.documentTitle)}
          ${localizedFieldset("notice", "评论区公告", settings.notice, "textarea", false)}
          <div class="admin-actions">
            <button class="btn btn--primary" type="submit">保存设置</button>
            <button class="btn" type="button" id="refreshButton">刷新数据</button>
          </div>
          <p class="admin-status" id="settingsStatus" role="status">${esc(state.status)}</p>
        </form>
      </section>
      <section class="admin-panel" aria-labelledby="comments-title">
        <h2 id="comments-title">留言管理</h2>
        <p>共 ${state.comments.length} 条。删除后会立即从 KV 的留言列表移除。</p>
        <div class="admin-list" id="adminCommentList">
          ${state.comments.length ? state.comments.map(commentItem).join("") : '<p class="comment-list__empty">暂无留言。</p>'}
        </div>
      </section>
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
  return `
    <article class="admin-comment" data-id="${esc(comment.id)}">
      <div class="admin-comment__head">
        <strong>${esc(comment.name || "Anonymous")}</strong>
        <button class="btn btn--danger js-delete-comment" type="button" data-id="${esc(comment.id)}">删除</button>
      </div>
      <p>${esc(comment.message || "")}</p>
      <div class="admin-comment__meta">
        <small>${esc(formatTime(comment.createdAt))}</small>
        <small>IP: ${esc(comment.ip || "unknown")} · 归属地: ${esc(commentLocation(comment))}</small>
      </div>
    </article>
  `;
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
  document.getElementById("settingsForm")?.addEventListener("submit", saveSettings);
  document.getElementById("refreshButton")?.addEventListener("click", loadDashboard);
  document.getElementById("logoutButton")?.addEventListener("click", logout);
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
  state.settings = emptySettings;
  state.comments = [];
  state.status = "已退出。";
  render();
}

async function saveSettings(event) {
  event.preventDefault();
  const status = document.getElementById("settingsStatus");
  if (status) status.textContent = "正在保存...";
  const form = new FormData(event.currentTarget);
  const payload = settingsFromForm(form);

  try {
    const response = await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await responseText(response));
    const data = await response.json();
    state.settings = data.settings;
    state.status = "设置已保存。";
    render();
  } catch (error) {
    if (status) status.textContent = error.message || "保存失败。";
  }
}

function settingsFromForm(form) {
  const pick = (name) => ({
    zh: String(form.get(`${name}.zh`) || "").trim(),
    ja: String(form.get(`${name}.ja`) || "").trim(),
    en: String(form.get(`${name}.en`) || "").trim(),
  });
  return {
    commentsEnabled: form.get("commentsEnabled") === "on",
    title: pick("title"),
    subtitle: pick("subtitle"),
    documentTitle: pick("documentTitle"),
    notice: pick("notice"),
  };
}

async function deleteComment(id) {
  if (!id) return;
  const button = document.querySelector(`.js-delete-comment[data-id="${CSS.escape(id)}"]`);
  if (button) button.disabled = true;

  try {
    const response = await api(`/api/admin/comments/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await responseText(response));
    state.comments = state.comments.filter((comment) => comment.id !== id);
    state.status = "留言已删除。";
    render();
  } catch (error) {
    state.status = error.message || "删除失败。";
    render();
  }
}

async function loadDashboard() {
  state.loading = true;
  render();
  try {
    const [settingsResponse, commentsResponse] = await Promise.all([
      api("/api/admin/settings"),
      api("/api/admin/comments?limit=100"),
    ]);
    if (!settingsResponse.ok) throw new Error(await responseText(settingsResponse));
    if (!commentsResponse.ok) throw new Error(await responseText(commentsResponse));
    const settingsData = await settingsResponse.json();
    const commentsData = await commentsResponse.json();
    state.authed = true;
    state.settings = settingsData.settings || emptySettings;
    state.comments = Array.isArray(commentsData.comments) ? commentsData.comments : [];
    state.loading = false;
    render();
  } catch (error) {
    state.authed = false;
    state.loading = false;
    state.status = error.message || "需要重新登录。";
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
