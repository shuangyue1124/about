import { languages, ui } from "./data.js";

const page = document.body.dataset.page || "home";
const root = document.body.dataset.root || ".";
const langKey = "sfsy-lang";

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

let lang = normalizeLang(document.body.dataset.lang) || langFromPath() || normalizeLang(storageGet(langKey)) || detectLang();
let siteSettings = null;
let pageViewTracked = false;
let toastTimer = 0;

function normalizeLang(value) {
  if (!value) return "";
  if (value.startsWith("ja")) return "ja";
  if (value.startsWith("en")) return "en";
  return "zh";
}

function detectLang() {
  return normalizeLang(navigator.language || navigator.userLanguage || "zh");
}

function langFromPath() {
  const first = window.location.pathname.split("/").filter(Boolean)[0] || "";
  if (first === "en" || first === "ja") return first;
  return "";
}

function label(key) {
  return ui[lang][key] || ui.zh[key] || key;
}

function settingText(key, fallback) {
  const value = siteSettings?.[key];
  if (value && typeof value === "object") return value[lang] || value.zh || fallback;
  return value || fallback;
}

function commentsEnabled() {
  return siteSettings?.commentsEnabled !== false;
}

function rootUrl(path) {
  if (!path) return root === "." ? "./" : `${root}/`;
  return root === "." ? path : `${root}/${path}`;
}

const commentUi = {
  zh: {
    title: "留言区",
    intro: "不用注册，也不用邮箱；写下名字和留言就可以。",
    name: "名称",
    message: "留言",
    namePlaceholder: "怎么称呼你",
    messagePlaceholder: "写点想说的话",
    submit: "发布留言",
    loading: "正在读取留言...",
    empty: "还没有留言。",
    success: "留言已发布。",
    pending: "留言已提交，正在等待管理员审核。",
    error: "留言暂时不可用。",
    disabled: "留言发布暂时关闭，已有留言仍可查看。",
    turnstileMissing: "留言防刷组件尚未配置，请稍后再试。",
    rateLimited: "留言太频繁，请稍后再试。",
    serviceUnavailable: "留言服务暂时不可用，请稍后再试。",
    turnstileFailed: "人机验证未通过，请重试。",
    ip: "IP",
    location: "归属地",
    unknownLocation: "未知归属地",
    time: "时间",
  },
  ja: {
    title: "コメント",
    intro: "登録やメールは不要です。名前とコメントだけで送れます。",
    name: "名前",
    message: "コメント",
    namePlaceholder: "表示する名前",
    messagePlaceholder: "書きたいこと",
    submit: "送信",
    loading: "コメントを読み込み中...",
    empty: "まだコメントはありません。",
    success: "コメントを投稿しました。",
    pending: "コメントを送信しました。管理者の確認を待っています。",
    error: "コメント機能は一時的に利用できません。",
    disabled: "コメント投稿は一時停止中です。既存のコメントは表示できます。",
    turnstileMissing: "スパム防止コンポーネントが未設定です。後でもう一度お試しください。",
    rateLimited: "送信が多すぎます。しばらくしてからお試しください。",
    serviceUnavailable: "コメント機能は一時的に利用できません。後でもう一度お試しください。",
    turnstileFailed: "認証に失敗しました。もう一度お試しください。",
    ip: "IP",
    location: "所在地",
    unknownLocation: "所在地不明",
    time: "時間",
  },
  en: {
    title: "Comments",
    intro: "No signup or email required. Just leave a name and a note.",
    name: "Name",
    message: "Comment",
    namePlaceholder: "How should I call you",
    messagePlaceholder: "Write a note",
    submit: "Post Comment",
    loading: "Loading comments...",
    empty: "No comments yet.",
    success: "Comment posted.",
    pending: "Comment submitted and waiting for admin review.",
    error: "Comments are temporarily unavailable.",
    disabled: "Posting is temporarily closed. Existing comments remain visible.",
    turnstileMissing: "The anti-spam challenge is not configured yet. Please try again later.",
    rateLimited: "Too many comments. Please try again later.",
    serviceUnavailable: "Comments are temporarily unavailable. Please try again later.",
    turnstileFailed: "Verification failed. Please try again.",
    ip: "IP",
    location: "Location",
    unknownLocation: "Unknown location",
    time: "Time",
  },
};

function commentLabel(key) {
  return commentUi[lang]?.[key] || commentUi.zh[key] || key;
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderCommentsSection() {
  const notice = settingText("notice", "");
  const form = commentsEnabled()
    ? `
      <form class="comment-form" id="commentForm" autocomplete="off">
        <label>
          <span>${esc(commentLabel("name"))}</span>
          <input name="name" maxlength="32" required placeholder="${esc(commentLabel("namePlaceholder"))}">
        </label>
        <label class="comment-form__message">
          <span>${esc(commentLabel("message"))}</span>
          <textarea name="message" maxlength="500" rows="5" required placeholder="${esc(commentLabel("messagePlaceholder"))}"></textarea>
        </label>
        <input class="comment-form__trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        ${siteSettings?.turnstileSiteKey ? `<div class="comment-form__turnstile cf-turnstile" data-sitekey="${esc(siteSettings.turnstileSiteKey)}"></div>` : `<p class="comment-notice">${esc(commentLabel("turnstileMissing"))}</p>`}
        <button class="btn btn--primary" type="submit" ${siteSettings?.turnstileSiteKey ? "" : "disabled"}>${esc(commentLabel("submit"))}</button>
        <p class="comment-form__status" id="commentStatus" role="status"></p>
      </form>
    `
    : `<p class="comment-notice">${esc(commentLabel("disabled"))}</p>`;

  return `
    <section class="comments-section" id="comments" data-comments>
      <div class="section-heading">
        <p class="eyebrow">${esc(commentLabel("title"))}</p>
        <h2>${esc(commentLabel("intro"))}</h2>
      </div>
      ${notice ? `<p class="comment-notice">${esc(notice)}</p>` : ""}
      ${form}
      <div class="comment-list" id="commentList" aria-live="polite">
        <p class="comment-list__empty">${esc(commentLabel("loading"))}</p>
      </div>
    </section>
  `;
}

function bindCommon() {
  document.querySelectorAll(".lang-menu__item").forEach((link) => {
    link.addEventListener("click", () => storageSet(langKey, link.getAttribute("hreflang")?.slice(0, 2) || "zh"));
  });
  bindCopyButtons();
  bindShareButtons();
  bindContactDownloads();
  bindAvatarFallback();
  bindTripImageFallback();
  bindPosterGallery();
  bindComments();
  bindNowStatus();
  bindThemeToggle();
  registerServiceWorker();
  trackPageView();
}

function bindPosterGallery() {
  const links = Array.from(document.querySelectorAll(".poster-card__link"));
  if (!links.length) return;

  let index = 0;
  let lightbox = null;
  let touchX = 0;

  const onKey = (event) => {
    if (!lightbox) return;
    if (event.key === "Escape") closeGallery();
    else if (event.key === "ArrowLeft") showPoster(index - 1);
    else if (event.key === "ArrowRight") showPoster(index + 1);
  };

  const showPoster = (next) => {
    index = (next + links.length) % links.length;
    const link = links[index];
    const img = lightbox.querySelector(".poster-lightbox__img");
    const caption = lightbox.querySelector(".poster-lightbox__caption");
    img.src = link.href;
    img.alt = link.getAttribute("aria-label") || "";
    caption.textContent = link.getAttribute("aria-label") || "";
  };

  const closeGallery = () => {
    lightbox.remove();
    lightbox = null;
    document.removeEventListener("keydown", onKey);
  };

  const openGallery = (start) => {
    lightbox = document.createElement("div");
    lightbox.className = "poster-lightbox";
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("aria-label", label("posterArchive"));
    lightbox.innerHTML = `
      <button class="poster-lightbox__close" type="button" aria-label="${esc(label("galleryClose"))}">×</button>
      <button class="poster-lightbox__nav poster-lightbox__nav--prev" type="button" aria-label="${esc(label("galleryPrev"))}">‹</button>
      <img class="poster-lightbox__img" alt="">
      <button class="poster-lightbox__nav poster-lightbox__nav--next" type="button" aria-label="${esc(label("galleryNext"))}">›</button>
      <p class="poster-lightbox__caption"></p>`;
    document.body.appendChild(lightbox);

    lightbox.querySelector(".poster-lightbox__close").addEventListener("click", closeGallery);
    lightbox.querySelector(".poster-lightbox__nav--prev").addEventListener("click", () => showPoster(index - 1));
    lightbox.querySelector(".poster-lightbox__nav--next").addEventListener("click", () => showPoster(index + 1));
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) closeGallery();
    });
    lightbox.addEventListener("pointerdown", (event) => {
      touchX = event.clientX;
    });
    lightbox.addEventListener("pointerup", (event) => {
      const delta = event.clientX - touchX;
      if (Math.abs(delta) > 48) showPoster(delta < 0 ? index + 1 : index - 1);
    });
    document.addEventListener("keydown", onKey);

    showPoster(start);
    lightbox.querySelector(".poster-lightbox__close").focus();
  };

  links.forEach((link, i) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openGallery(i);
    });
  });
}

function bindAvatarFallback() {
  document.querySelectorAll(".avatar-ring img, .brand__mark img").forEach((img) => {
    const fail = () => img.classList.add("is-broken");
    img.addEventListener("error", fail, { once: true });
    if (img.complete && img.naturalWidth === 0) fail();
  });
}

function bindCopyButtons() {
  document.querySelectorAll(".js-copy").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.dataset.copy || "";
      const ok = await copyText(value);
      button.classList.add(ok ? "is-copied" : "is-failed");
      showToast(ok ? label("copied") : label("copyFail"), ok ? "success" : "error");
      const state = button.querySelector(".copy-state");
      if (state) state.textContent = ok ? label("copied") : label("copyFail");
      window.setTimeout(() => {
        button.classList.remove("is-copied", "is-failed");
        if (state) state.textContent = button.classList.contains("terminal__copy") ? label("terminalLabel") : "";
      }, 1400);
    });
  });
}

async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the textarea method.
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-999px";
  document.body.appendChild(input);
  input.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  input.remove();
  return ok;
}

function bindTripImageFallback() {
  document.querySelectorAll(".trip-hero__poster img, .poster-media img").forEach((img) => {
    const fail = () => {
      img.classList.add("is-broken");
      img.closest(".trip-hero__poster, .poster-media")?.setAttribute("data-image-state", "error");
    };
    img.addEventListener("error", fail, { once: true });
    if (img.complete && img.naturalWidth === 0) fail();
  });
}

function bindShareButtons() {
  document.querySelectorAll(".js-share").forEach((button) => {
    button.addEventListener("click", async () => {
      const shareData = {
        title: document.title,
        text: label("shareText"),
        url: window.location.href,
      };

      if (navigator.share && window.isSecureContext) {
        try {
          await navigator.share(shareData);
          showToast(label("shareSuccess"), "success");
          return;
        } catch (error) {
          if (error?.name === "AbortError") {
            showToast(label("shareCanceled"));
            return;
          }
        }
      }

      const copied = await copyText(shareData.url);
      showToast(copied ? label("shareCopied") : label("shareFail"), copied ? "success" : "error");
    });
  });
}

function bindContactDownloads() {
  document.querySelectorAll(".js-download-contact").forEach((link) => {
    link.addEventListener("click", () => showToast(label("downloadStarted"), "success"));
  });
}

function showToast(message, state = "info") {
  const toast = document.getElementById("pageToast");
  if (!toast || !message) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.state = state;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    toast.textContent = "";
    delete toast.dataset.state;
  }, 2600);
}

function bindTravelSearch() {
  const input = document.getElementById("citySearch");
  if (!input) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    const cards = Array.from(document.querySelectorAll(".city-preview"));
    let shown = 0;
    cards.forEach((card) => {
      const match = !query || card.dataset.search.includes(query);
      card.hidden = !match;
      if (match) shown += 1;
    });
    document.querySelectorAll(".timeline-group").forEach((group) => {
      group.hidden = !group.querySelector(".city-preview:not([hidden])");
    });
    const empty = document.querySelector(".no-results");
    if (empty) empty.hidden = shown > 0;
  });
}

function bindComments() {
  const form = document.getElementById("commentForm");
  const list = document.getElementById("commentList");
  const status = document.getElementById("commentStatus");
  if (!list) return;

  loadComments(list);
  if (!form) return;
  loadTurnstile();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type='submit']");
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      message: String(formData.get("message") || "").trim(),
      website: String(formData.get("website") || ""),
      turnstileToken: String(formData.get("cf-turnstile-response") || ""),
    };

    if (!payload.name || !payload.message || !payload.turnstileToken) return;
    submit.disabled = true;
    if (status) status.textContent = "";

    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw { status: response.status, data };
      }
      const data = await response.json().catch(() => ({}));
      form.reset();
      if (window.turnstile) window.turnstile.reset();
      if (status) status.textContent = data.status === "pending" ? commentLabel("pending") : commentLabel("success");
      if (data.comment && data.status === "approved") {
        prependComment(list, data.comment);
      } else {
        await loadComments(list);
      }
    } catch (error) {
      if (status) status.textContent = commentFailureLabel(error);
    } finally {
      submit.disabled = false;
    }
  });
}

function commentFailureLabel(error) {
  const status = Number(error?.status) || 0;
  if (status === 429) return commentLabel("rateLimited");
  if (status === 503) return commentLabel("serviceUnavailable");
  const codes = Array.isArray(error?.data?.codes) ? error.data.codes : [];
  if (status === 401 || (status === 400 && codes.length)) return commentLabel("turnstileFailed");
  return commentLabel("error");
}

function prependComment(list, comment) {
  const empty = list.querySelector(".comment-list__empty");
  if (empty) empty.remove();
  list.insertAdjacentHTML("afterbegin", commentItem(comment));
}

function loadTurnstile() {
  if (!siteSettings?.turnstileSiteKey || document.querySelector("script[data-turnstile]")) return;
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  script.async = true;
  script.defer = true;
  script.dataset.turnstile = "true";
  document.head.appendChild(script);
}

const nowStatusNotes = {
  lunch: {
    zh: "午间为午餐与休息时间。",
    ja: "昼は昼食と休憩の時間です。",
    en: "Midday is lunch and rest time.",
  },
  dinner: {
    zh: "晚餐时间（约 17:40–19:00）。",
    ja: "夕食の時間（17:40–19:00頃）。",
    en: "Dinner time (around 17:40–19:00).",
  },
  noonReading: {
    zh: "另有午读（数学），时间不固定。",
    ja: "昼読書（数学）もありますが、時間は流動的です。",
    en: "Plus noon reading (Mathematics) at a varying time.",
  },
  now: { zh: "现在", ja: "今", en: "now" },
};

function nowNoteText(key) {
  return nowStatusNotes[key]?.[lang] || nowStatusNotes[key]?.zh || "";
}

// "What am I doing now" widget: computed entirely in the browser from the
// static timetable in schedule.js. No API requests, no D1/KV writes. The
// timetable module is loaded lazily so a missing schedule.js can never break
// the rest of the page (theme, comments, sharing all keep working).
function bindNowStatus() {
  const card = document.querySelector("[data-now-status]");
  if (!card) return;
  import("./schedule.js").then((schedule) => {
    try {
      initNowStatus(card, schedule);
    } catch {
      card.remove();
    }
  }).catch(() => {
    card.remove();
  });
}

function initNowStatus(card, schedule) {
  const textEl = card.querySelector("[data-now-text]");
  const timeEl = card.querySelector("[data-now-time]");
  const toggle = document.getElementById("nowStatusToggle");
  const panel = document.getElementById("nowStatusPanel");
  if (!textEl || !timeEl) return;

  const tick = () => {
    if (document.hidden) return;
    const now = new Date();
    timeEl.textContent = schedule.formatChinaTime(now);
    try {
      textEl.textContent = schedule.statusText(schedule.resolveStatus(now), lang);
    } catch {
      textEl.textContent = "";
    }
    if (panel && !panel.hidden) renderNowPanel(panel, now, schedule);
  };

  card.hidden = false;
  tick();
  const timer = window.setInterval(tick, 45000);
  window.addEventListener("pagehide", () => window.clearInterval(timer));

  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      const open = panel.hidden;
      if (open) {
        renderNowPanel(panel, new Date(), schedule);
        panel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
      } else {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }
}

function renderNowPanel(panel, now, schedule) {
  const day = schedule.describeDay(now);
  const parts = schedule.chinaParts(now);
  const heading = `${schedule.chinaWeekdayName(now, lang)} · ${label("nowStatusTimetable")}`;
  if (day.isRestDay) {
    panel.innerHTML = `<p class="now-status__day">${esc(heading)}</p><p class="now-status__note">${esc(schedule.statusText({ kind: "rest" }, lang))}</p>`;
    return;
  }
  const toMin = (value) => {
    const [h, m] = String(value).split(":").map(Number);
    return h * 60 + m;
  };
  const rows = day.slots.map((slot) => {
    const current = parts.totalMinutes >= toMin(slot.start) && parts.totalMinutes < toMin(slot.end);
    return `<li${current ? ' aria-current="true"' : ""}><time>${esc(slot.start)}–${esc(slot.end)}</time><span>${esc(schedule.slotLabel(slot, lang))}</span>${current ? `<span class="now-status__nowtag">${esc(nowNoteText("now"))}</span>` : ""}</li>`;
  }).join("");
  const notes = day.notes.map((note) => {
    if (note.kind === "lunch-note") return `<p class="now-status__note">${esc(nowNoteText("lunch"))}</p>`;
    if (note.kind === "dinner-note") return `<p class="now-status__note">${esc(nowNoteText("dinner"))}</p>`;
    if (note.kind === "noon-reading-note") return `<p class="now-status__note">${esc(nowNoteText("noonReading"))}</p>`;
    return "";
  }).join("");
  panel.innerHTML = `<p class="now-status__day">${esc(heading)}</p><ol class="now-status__list">${rows}</ol>${notes}`;
}

function bindThemeToggle() {
  document.querySelectorAll(".js-theme").forEach((button) => {
    button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      storageSet("sfsy-theme", next);
    });
  });
  const stored = storageGet("sfsy-theme");
  if (stored) document.documentElement.dataset.theme = stored;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") return;
  navigator.serviceWorker.register(rootUrl("sw.js")).catch(() => {});
}

function trackPageView() {
  if (pageViewTracked || window.location.protocol === "file:") return;
  pageViewTracked = true;
  const payload = JSON.stringify({
    type: "page_view",
    path: window.location.pathname,
    page,
    lang,
    title: document.title,
    referrer: document.referrer,
  });
  if (navigator.sendBeacon) {
    try {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon("/api/events", blob)) return;
    } catch {
      // Fall back to a keepalive request below.
    }
  }
  fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

async function loadComments(list) {
  list.innerHTML = `<p class="comment-list__empty">${esc(commentLabel("loading"))}</p>`;
  try {
    const response = await fetch("/api/comments?limit=30", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("comments unavailable");
    const data = await response.json();
    const comments = Array.isArray(data.comments) ? data.comments : [];
    renderComments(list, comments);
  } catch {
    list.innerHTML = `<div class="comment-list__empty"><p>${esc(commentLabel("error"))}</p><button class="btn btn--compact js-retry-comments" type="button">${esc(label("retry"))}</button></div>`;
    const retry = list.querySelector(".js-retry-comments");
    retry?.addEventListener("click", () => loadComments(list), { once: true });
  }
}

async function loadSiteSettings() {
  try {
    const response = await fetch("/api/site", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("site settings unavailable");
    const data = await response.json();
    if (data.settings && typeof data.settings === "object") siteSettings = data.settings;
  } catch {
    siteSettings = null;
  }
}

function applySiteSettings() {
  if (!siteSettings) return;

  const title = settingText("title", label("heroTitle"));
  document.querySelectorAll(".brand__name").forEach((element) => {
    element.textContent = title;
  });

  if (page !== "home") return;
  const heading = document.querySelector(".hero h1");
  const subtitle = document.querySelector(".hero__subtitle");
  if (heading) heading.textContent = title;
  if (subtitle) subtitle.textContent = settingText("subtitle", label("heroSubtitle"));

  const comments = document.querySelector("[data-comments]");
  if (comments) {
    comments.outerHTML = renderCommentsSection();
    bindComments();
  }
}

function renderComments(list, comments) {
  if (!comments.length) {
    list.innerHTML = `<p class="comment-list__empty">${esc(commentLabel("empty"))}</p>`;
    return;
  }

  list.innerHTML = comments.map(commentItem).join("");
}

function commentItem(comment) {
  return `
    <article class="comment-item">
      <div class="comment-item__head">
        <strong>${esc(comment.name || "")}</strong>
        <span>${esc(commentTime(comment.createdAt))}</span>
      </div>
      <p>${esc(comment.message || "")}</p>
      <small>${esc(commentLabel("ip"))}: ${esc(comment.ip || "unknown")} · ${esc(commentLabel("location"))}: ${esc(commentLocation(comment))}</small>
    </article>
  `;
}

function commentLocation(comment) {
  const value = String(comment.ipLocation || comment.location || "").trim();
  if (!value || value.toLowerCase() === "unknown location") return commentLabel("unknownLocation");
  return value;
}

function commentTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(languages.find((item) => item.code === lang)?.html || "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Bind the complete static document immediately. Runtime settings enhance only
// the affected nodes so a slow API cannot delay or replace the NFC card shell.
try {
  bindCommon();
  if (page === "travel") bindTravelSearch();
} catch {
  // Keep the static document usable even if a browser API is unavailable.
}

loadSiteSettings().then(applySiteSettings).catch(() => {});
