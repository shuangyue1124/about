import { languages, ui } from "./data.js";
import {
  MODULE_IDS,
  filterTravelCities,
  normalizeLangCode,
  resolveAutoLanguage,
} from "./site-profile.js";

const page = document.body.dataset.page || "home";
const root = document.body.dataset.root || ".";
const langKey = "sfsy-lang";
// Languages that have no static page and are served by the AI translator.
const AI_LANG_CODES = new Set(languages.filter((item) => item.ai).map((item) => item.code));

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

const storedLangInitial = normalizeLang(storageGet(langKey));
// An explicitly chosen AI language (ko, fr, …) has no static page, so it must
// override the static locale path — otherwise a choice made on /en/ would be
// silently dropped on every reload (the old chain short-circuited on
// dataset.lang and applyProfileLanguage even wrote the path language back).
let lang = isAiLang(storedLangInitial)
  ? storedLangInitial
  : normalizeLang(document.body.dataset.lang) || langFromPath() || storedLangInitial || detectLang();
let siteSettings = null;
let siteProfile = null;
let siteContacts = [];
let siteGeo = { country: "", timezone: "", city: "" };
let pageViewTracked = false;
let toastTimer = 0;
// AI translation state: aiLang is empty for the static zh/ja/en pages, and
// aiDict is swapped in only after every chunk of a language has arrived, so a
// page is never left half-translated.
let aiLang = "";
let aiDict = null;
// Source text -> translation, shared by every id with the same copy; lets the
// incremental pass (comments, content cards) skip already-translated text.
let aiTextDict = null;
// Ids the model could not fit in its output budget. They keep the source
// language and are offered a manual translate button instead of failing the
// page (see startAiTranslation).
let aiSkipped = new Set();
// Guards against startAiTranslation racing the incremental translateNewContent
// calls fired by loadComments / loadContentSections.
let aiTranslationActive = false;

function normalizeLang(value) {
  // AI languages are not known to normalizeLangCode (it only maps zh/ja/en),
  // so accept them explicitly — otherwise a remembered choice such as "ko"
  // would silently collapse back to "zh" on the next visit.
  return normalizeLangCode(value) || (AI_LANG_CODES.has(value) ? value : value ? "zh" : "");
}

function isAiLang(value) {
  return AI_LANG_CODES.has(value);
}

function languageLabel(code) {
  return languages.find((item) => item.code === code)?.label || code;
}

function detectLang() {
  // Single authority: weights live in site-profile.js resolveAutoLanguage
  // (browser 5 + timezone 3 + server geo 3). Server only returns geo; the
  // browser computes the final language here. Order: pinned profile >
  // saved sfsy-lang > auto > zh fallback (see applyProfileLanguage).
  let timezone = "";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch { timezone = ""; }
  return resolveAutoLanguage({
    browserLang: navigator.language || navigator.userLanguage || "zh",
    timezone,
    cfCountry: siteGeo.country,
  });
}

function applyProfileLanguage() {
  // An explicitly chosen AI language always wins: it has no static page, so the
  // visitor wants this document translated in place. Never overwrite it with
  // the pinned profile or the locale path (that used to erase the choice).
  if (isAiLang(lang)) return;
  // Domain profile may pin language; otherwise auto-detect once and remember.
  const pinned = siteProfile?.language;
  if (pinned === "zh" || pinned === "ja" || pinned === "en") {
    lang = pinned;
    return;
  }
  const pathLang = langFromPath();
  if (pathLang) {
    // Static locale path (/en/, /ja/) remains authoritative for the shell;
    // dynamic modules still use the same lang. Remember it for future root visits.
    lang = pathLang;
    storageSet(langKey, lang);
    return;
  }
  const stored = normalizeLang(storageGet(langKey));
  if (stored) {
    lang = stored;
    return;
  }
  lang = detectLang();
  storageSet(langKey, lang);
}

function moduleEnabled(id) {
  if (!siteProfile?.modules) return true;
  return siteProfile.modules.includes(id);
}

function langFromPath() {
  const first = window.location.pathname.split("/").filter(Boolean)[0] || "";
  if (first === "en" || first === "ja") return first;
  return "";
}

function label(key) {
  // aiDict wins while an AI language is active; the optional chaining matters
  // because ui has no entry for those languages at all.
  return (aiDict && aiLang ? aiDict[`ui:${key}`] : "") || ui[lang]?.[key] || ui.zh[key] || key;
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
    reply: "回复",
    replyTo: "回复",
    replyingTo: "正在回复",
    cancelReply: "取消回复",
    translate: "翻译这条",
    translating: "翻译中…",
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
    reply: "返信",
    replyTo: "返信",
    replyingTo: "返信中",
    cancelReply: "返信をやめる",
    translate: "翻訳する",
    translating: "翻訳中…",
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
    reply: "Reply",
    replyTo: "Reply to",
    replyingTo: "Replying to",
    cancelReply: "Cancel reply",
    translate: "Translate",
    translating: "Translating…",
  },
};

function commentLabel(key) {
  return (aiDict && aiLang ? aiDict[`ui:comment:${key}`] : "") || commentUi[lang]?.[key] || commentUi.zh[key] || key;
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
        <input type="hidden" name="parentId" id="commentParentId" value="">
        <p class="comment-reply-context" id="commentReplyContext" hidden>
          <span id="commentReplyContextText"></span>
          <button class="btn btn--compact js-cancel-reply" type="button">${esc(commentLabel("cancelReply"))}</button>
        </p>
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
  // Language UI is intentionally hidden: only remember explicit locale links
  // when they exist (legacy cached HTML). Theme buttons carry no hreflang and
  // must never overwrite the auto-detected sfsy-lang value.
  document.querySelectorAll(".lang-menu__item[hreflang]").forEach((link) => {
    link.addEventListener("click", () => {
      const code = normalizeLang(link.getAttribute("hreflang"));
      if (code) storageSet(langKey, code);
    });
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
  bindLangSelector();
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
  bindReplyButtons(list, form);
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
      parentId: String(formData.get("parentId") || "").trim(),
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
      setReplyTarget(form, "", "");
      if (window.turnstile) window.turnstile.reset();
      if (status) status.textContent = data.status === "pending" ? commentLabel("pending") : commentLabel("success");
      if (data.comment && data.status === "approved") {
        // Re-render the whole tree: a new reply must land under its parent,
        // which a plain prepend cannot know.
        if (commentsCache.comments) commentsCache.comments.unshift(data.comment);
        renderComments(liveCommentList(list), commentsCache.comments);
        translateNewContent().catch(() => {});
      } else {
        await loadComments(list, { force: true });
      }
    } catch (error) {
      if (status) status.textContent = commentFailureLabel(error);
      // A failed verification consumes the Turnstile token server-side; without
      // a reset every retry would keep failing with the same spent token.
      if (window.turnstile) window.turnstile.reset();
    } finally {
      submit.disabled = false;
    }
  });
}

// Reply buttons live inside dynamically rendered comments, so clicks are
// delegated from the list container. All replies reuse the single main form
// (and its one Turnstile widget) instead of spawning per-comment forms.
function bindReplyButtons(list, form) {
  if (!list || !form) return;
  list.addEventListener("click", (event) => {
    const translateButton = event.target.closest?.(".js-translate-comment");
    if (translateButton) {
      event.preventDefault();
      translateCommentManually(list, translateButton.dataset.id || "", translateButton);
      return;
    }
    const button = event.target.closest?.(".js-reply-comment");
    if (!button) return;
    setReplyTarget(form, button.dataset.id || "", button.dataset.name || "");
    const field = form.querySelector("textarea[name='message']") || form.querySelector("input[name='name']");
    field?.focus({ preventScroll: true });
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  form.querySelector(".js-cancel-reply")?.addEventListener("click", () => {
    setReplyTarget(form, "", "");
  });
}

// A comment too long for one model response stays in the source language and
// gets a button instead. Translating it alone is cheap: the worker chunks long
// copy internally, so this succeeds where the all-at-once page pass could not.
async function translateCommentManually(list, id, button) {
  const comment = (commentsCache.comments || []).find((item) => item.id === id);
  if (!comment?.message) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = commentLabel("translating");
  try {
    const data = await requestTranslations([{ id: `comment:${id}`, text: comment.message }]);
    const value = data.translations?.[`comment:${id}`];
    if (!value) throw new Error("no translation returned");
    if (!aiDict) aiDict = {};
    if (!aiTextDict) aiTextDict = {};
    aiDict[`comment:${id}`] = value;
    aiTextDict[comment.message] = value;
    aiSkipped.delete(`comment:${id}`);
    if (aiDict) renderComments(list, commentsCache.comments);
  } catch (error) {
    console.warn("[translate] comment failed", error?.message || error);
    button.disabled = false;
    button.textContent = original;
  }
}

function setReplyTarget(form, id, name) {
  if (!form) return;
  const input = form.querySelector("#commentParentId");
  if (input) input.value = id || "";
  const context = form.querySelector("#commentReplyContext");
  const text = form.querySelector("#commentReplyContextText");
  if (context && text) {
    const active = Boolean(id);
    context.hidden = !active;
    text.textContent = active ? `${commentLabel("replyingTo")} @${name || ""}` : "";
  }
}

function commentFailureLabel(error) {
  const status = Number(error?.status) || 0;
  if (status === 429) return commentLabel("rateLimited");
  if (status === 503) return commentLabel("serviceUnavailable");
  const codes = Array.isArray(error?.data?.codes) ? error.data.codes : [];
  if (status === 401 || (status === 400 && codes.length)) return commentLabel("turnstileFailed");
  return commentLabel("error");
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
    zh: "晚餐时间（19:00–19:40）。",
    ja: "夕食の時間（19:00–19:40）。",
    en: "Dinner time (19:00–19:40).",
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
  // Automated browsers (headless crawlers, smoke tests) would otherwise write
  // one D1 row per load; skip them client-side at zero server cost.
  if (navigator.webdriver) return;
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

// Homepage init intentionally binds comments twice: once for the static shell in
// bindCommon(), once after /api/site re-renders the section in
// applySiteSettings(). Both binds share one in-flight request plus a short
// fresh cache below, so a normal visit costs a single GET /api/comments.
let commentsRequest = null;
let commentsCache = { comments: null, at: 0 };
const COMMENTS_CACHE_MS = 30 * 1000;

function liveCommentList(fallback) {
  return fallback.isConnected ? fallback : document.getElementById("commentList") || fallback;
}

async function loadComments(list, options = {}) {
  const target = liveCommentList(list);
  target.innerHTML = `<p class="comment-list__empty">${esc(commentLabel("loading"))}</p>`;
  try {
    if (!options.force && commentsCache.comments && Date.now() - commentsCache.at < COMMENTS_CACHE_MS) {
      renderComments(target, commentsCache.comments);
      translateNewContent().catch(() => {});
      return;
    }
    if (!commentsRequest) {
      commentsRequest = (async () => {
        const response = await fetch("/api/comments?limit=30", { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("comments unavailable");
        const data = await response.json();
        const comments = Array.isArray(data.comments) ? data.comments : [];
        commentsCache = { comments, at: Date.now() };
        return comments;
      })().finally(() => {
        commentsRequest = null;
      });
    }
    // The list node may have been replaced by the site-settings re-render
    // while the request was in flight; render into the live node instead of
    // a detached one so a retry is never needed for that race.
    renderComments(liveCommentList(list), await commentsRequest);
    // Late comments (slow API) are translated by the incremental pass.
    translateNewContent().catch(() => {});
  } catch {
    const retryTarget = liveCommentList(list);
    retryTarget.innerHTML = `<div class="comment-list__empty"><p>${esc(commentLabel("error"))}</p><button class="btn btn--compact js-retry-comments" type="button">${esc(label("retry"))}</button></div>`;
    const retry = retryTarget.querySelector(".js-retry-comments");
    retry?.addEventListener("click", () => loadComments(retryTarget, { force: true }), { once: true });
  }
}

async function loadSiteSettings() {
  try {
    const response = await fetch("/api/site", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("site settings unavailable");
    const data = await response.json();
    if (data.settings && typeof data.settings === "object") siteSettings = data.settings;
    if (data.profile && typeof data.profile === "object") siteProfile = data.profile;
    if (Array.isArray(data.contacts)) siteContacts = data.contacts;
    if (data.geo && typeof data.geo === "object") siteGeo = { country: String(data.geo.country || ""), timezone: String(data.geo.timezone || ""), city: String(data.geo.city || "") };
  } catch {
    siteSettings = siteSettings || null;
  }
}

// Lightweight module registry: profile.modules decides what is visible.
// No giant if/else chain; each renderer is a small function below.
const siteModules = {
  profile: applyProfileModule,
  about: applyAboutModule,
  contacts: applyContactsModule,
  travel: applyTravelModule,
  anime: () => applyContentModule("anime"),
  games: () => applyContentModule("games"),
  github: () => applyContentModule("github"),
  comments: applyCommentsModule,
};

function applySiteSettings() {
  // Language first: pinned profile language wins, otherwise weighted auto + memory.
  if (siteProfile) applyProfileLanguage();

  if (siteSettings) {
    const title = settingText("title", label("heroTitle"));
    document.querySelectorAll(".brand__name").forEach((element) => {
      element.textContent = profileTitleText(title);
    });
    if (page === "home") {
      const heading = document.querySelector(".hero h1");
      const subtitle = document.querySelector(".hero__subtitle");
      if (heading) heading.textContent = profileTitleText(title);
      if (subtitle) subtitle.textContent = profileSubtitleText(settingText("subtitle", label("heroSubtitle")));
    }
  }

  // Per-hostname SEO: canonical/og:url always point at the current hostname,
  // never at about.shuangyue.space from another domain.
  applySeoForHostname();

  if (siteProfile) {
    for (const id of siteProfile.modules || MODULE_IDS) {
      try { siteModules[id]?.(); } catch { /* one module must never break the page */ }
    }
    hideDisabledModules();
  }

  // Comments section re-render keeps existing behaviour (enabled flag + i18n).
  if (siteSettings) {
    const comments = document.querySelector("[data-comments]");
    if (comments && siteProfile?.modules?.includes("comments") !== false) {
      comments.outerHTML = renderCommentsSection();
      bindComments();
    }
  }

  if (siteContacts.length) renderContactsFromApi();
  if (page === "travel" || page === "home") filterTravelDom();
  if (page === "anime" || page === "games" || page === "github" || page === "home") {
    // Content cards render asynchronously; translate whatever they add once ready.
    Promise.resolve(loadContentSections()).then(() => translateNewContent()).catch(() => {});
  }

  // Runs last: the comment section has been rebuilt by now, so an AI language
  // translates the final DOM (and the comment bodies already in the cache).
  startAiTranslation().then(() => translateNewContent()).catch(() => {});
}

function profileTitleText(fallback) {
  const v = siteProfile?.title;
  if (v && typeof v === "object") return v[lang] || v.zh || fallback;
  return fallback;
}

function profileSubtitleText(fallback) {
  const v = siteProfile?.subtitle;
  if (v && typeof v === "object") return v[lang] || v.zh || fallback;
  return fallback;
}

function applySeoForHostname() {
  try {
    const host = window.location.hostname.toLowerCase();
    const path = window.location.pathname + window.location.search;
    const canonicalUrl = `${window.location.protocol}//${host}${path}`;
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute("href", canonicalUrl);
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute("content", canonicalUrl);
    document.documentElement.lang = languages.find((item) => item.code === lang)?.html || "zh-CN";
  } catch { /* SEO enhancement is best-effort */ }
}

function hideDisabledModules() {
  const mods = new Set(siteProfile?.modules || MODULE_IDS);
  // Static shells carry data-module where available (build-pages); legacy nodes
  // fall back to id/class matching below so old cached HTML still filters safely.
  document.querySelectorAll("[data-module]").forEach((el) => {
    if (!mods.has(el.getAttribute("data-module"))) el.remove();
  });
  if (!mods.has("comments")) document.querySelector("[data-comments]")?.remove();
  if (!mods.has("contacts")) document.getElementById("contact")?.remove();
  if (!mods.has("travel")) {
    // Home travel card is identified by its travel link; travel page keeps shell
    // but shows an empty state (display control only, no 404 in phase one).
    document.querySelectorAll(".feature-card").forEach((card) => {
      if (card.querySelector('a[href*="travel"]') && card.querySelector(".eyebrow")?.textContent?.includes(label("travelTitle").slice(0, 2))) card.remove();
    });
  }
}

function applyProfileModule() { /* hero always visible when profile module present */ }
function applyAboutModule() { /* about card stays; hidden only via data-module when custom template excludes it */ }
function applyCommentsModule() { /* handled in applySiteSettings re-render */ }
function applyContactsModule() { /* handled by renderContactsFromApi */ }
function applyTravelModule() { /* handled by filterTravelDom */ }
function applyContentModule() { /* handled by loadContentSections */ }

function contactDesc(item) {
  const map = {
    wechat: { zh: "微信联系", ja: "WeChatで連絡", en: "Contact via WeChat" },
    qq: { zh: "点击复制 QQ 号", ja: "QQ番号をコピー", en: "Click to copy QQ number" },
    telegram: { zh: "点击打开 Telegram 会话", ja: "Telegramを開く", en: "Open a Telegram chat" },
    email: { zh: "点击发送电子邮件", ja: "メールを送る", en: "Send an email" },
    github: { zh: "查看代码与项目", ja: "コードとプロジェクトを見る", en: "View code and projects" },
    steam: { zh: "打开 Steam 个人资料", ja: "Steamプロフィールを開く", en: "Open Steam profile" },
    minecraft: { zh: "Minecraft 联机", ja: "Minecraftで遊ぶ", en: "Play Minecraft together" },
    genshin: { zh: "原神 UID", ja: "原神 UID", en: "Genshin UID" },
  };
  const key = String(item.type || "").toLowerCase();
  return map[key]?.[lang] || map[key]?.zh || "";
}

function renderContactsFromApi() {
  const grid = document.querySelector("[data-contacts]") || document.querySelector(".contact-grid");
  if (!grid || !siteContacts.length) return;
  // Only the API-provided (already filtered) contacts are rendered. Hidden
  // contact values never touch the DOM on wx/qq/github/travel hosts.
  const cards = siteContacts.map((item) => {
    const desc = contactDesc(item);
    const labelText = esc(item.label || item.type);
    const valueText = esc(item.value || "");
    if (item.url && item.url.startsWith("http")) {
      return `<a class="contact-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span>${labelText}</span><strong>${valueText}</strong><small>${esc(desc)}</small></a>`;
    }
    if (item.url && item.url.startsWith("mailto:")) {
      return `<a class="contact-link" href="${esc(item.url)}"><span>${labelText}</span><strong>${valueText}</strong><small>${esc(desc)}</small></a>`;
    }
    return `<button class="contact-link js-copy" type="button" data-copy="${esc(item.value || "")}"><span>${labelText}</span><strong>${valueText}</strong><small>${esc(desc)}</small></button>`;
  }).join("");
  const vcard = `<a class="contact-link js-download-contact" href="/contact.vcf" download><span>vCard</span><strong>${esc(label("saveContact"))}</strong><small>${esc(label("saveContactHint"))}</small></a>`;
  grid.innerHTML = cards + vcard;
  bindCopyButtons();
  bindContactDownloads();
}

function filterTravelDom() {
  const travel = siteProfile?.travel;
  if (!travel) return;
  if (travel.mode === "disabled") {
    document.querySelectorAll(".city-preview").forEach((el) => el.remove());
    document.querySelectorAll(".timeline-group").forEach((el) => el.remove());
    const empty = document.querySelector(".no-results");
    if (empty) { empty.hidden = false; }
    return;
  }
  const allSlugs = Array.from(document.querySelectorAll(".city-preview")).map((el) => {
    const href = el.getAttribute("href") || "";
    const m = href.match(/cities\/([^/.]+)/);
    return m ? m[1].toLowerCase() : "";
  }).filter(Boolean);
  if (!allSlugs.length) return;
  const allowed = new Set(filterTravelCities(allSlugs.length ? [...new Set([...allSlugs, "japan-2026"])] : [], travel).map((s) => String(s).toLowerCase()));
  // japan-2026 is a trip page, not a .city-preview; gate its stat card separately.
  const showJapan = allowed.has("japan-2026");
  if (!showJapan) document.querySelector(".stat-card--seal")?.remove();
  document.querySelectorAll(".city-preview").forEach((el) => {
    const href = el.getAttribute("href") || "";
    const m = href.match(/cities\/([^/.]+)/);
    const slug = m ? m[1].toLowerCase() : "";
    if (slug && !allowed.has(slug)) el.remove();
  });
  document.querySelectorAll(".timeline-group").forEach((group) => {
    if (!group.querySelector(".city-preview")) group.remove();
  });
}

async function loadContentSections() {
  const lists = document.querySelectorAll("[data-content-list]");
  if (!lists.length) return;
  for (const list of lists) {
    const type = list.getAttribute("data-content-list");
    if (!type) continue;
    // Respect profile gating client-side as well (server already gates).
    const need = type === "anime" ? "anime" : type === "games" ? "games" : type === "github" ? "github" : "";
    if (need && !moduleEnabled(need)) { list.innerHTML = ""; continue; }
    try {
      const apiType = type === "games" ? "game" : type;
      const res = await fetch(`/api/content?type=${encodeURIComponent(apiType)}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error("content unavailable");
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        list.innerHTML = `<p class="comment-list__empty">${esc(label("noResults"))}</p>`;
        continue;
      }
      list.innerHTML = items.slice(0, 12).map((item) => {
        const title = item.title?.[lang] || item.title?.zh || "";
        const summary = item.summary?.[lang] || item.summary?.zh || "";
        return `<article class="feature-card"><div class="feature-card__text"><p class="eyebrow">${esc(type)}</p><h3>${esc(title)}</h3><p>${esc(summary)}</p>${item.url ? `<p><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.url)}</a></p>` : ""}</div></article>`;
      }).join("");
    } catch {
      list.innerHTML = `<p class="comment-list__empty">${esc(label("noResults"))}</p>`;
    }
  }
}

function renderComments(list, comments) {
  if (!comments.length) {
    list.innerHTML = `<p class="comment-list__empty">${esc(commentLabel("empty"))}</p>`;
    return;
  }

  list.innerHTML = renderCommentTree(comments);
}

// Replies are stored as a flat list with parent_id. The public page shows one
// nesting level: direct replies sit under their root comment, while replies to
// a reply stay flat inside the same group and are labelled "回复 @name" instead
// of growing another indentation level (keeps mobile readable).
function buildCommentTree(comments) {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  // A rejected parent hides its replies here, but the rows stay in the database
  // so re-approving the parent brings the whole thread back.
  const hidden = (comment) => comment.parentStatus === "rejected";
  const rootOf = (comment) => {
    let current = comment;
    let hops = 0;
    while (current.parentId && hops < 64) {
      const parent = byId.get(current.parentId);
      if (!parent || hidden(parent)) break;
      current = parent;
      hops += 1;
    }
    return current;
  };

  const tops = [];
  const childrenByRoot = new Map();
  for (const comment of comments) {
    if (hidden(comment)) continue;
    const root = rootOf(comment);
    if (root.id === comment.id) {
      tops.push(comment);
      continue;
    }
    if (!childrenByRoot.has(root.id)) childrenByRoot.set(root.id, []);
    childrenByRoot.get(root.id).push(comment);
  }
  // Oldest first inside a thread; the backend already returns newest-first, so
  // top-level comments keep that order by pushing in iteration order.
  for (const children of childrenByRoot.values()) {
    children.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }
  return { tops, childrenByRoot };
}

function renderCommentTree(comments) {
  const { tops, childrenByRoot } = buildCommentTree(comments);
  return tops
    .map((top) => {
      const children = childrenByRoot.get(top.id) || [];
      const replies = children.map((child) => commentItem(child, { reply: true, topId: top.id })).join("");
      return commentItem(top, { topId: top.id }) + replies;
    })
    .join("");
}

// Translated comment text wins when the AI translation dictionary has it;
// otherwise the original message is shown (never blank).
function commentMessage(comment) {
  const translated = aiDict && aiLang ? aiDict[`comment:${comment.id}`] : "";
  return translated || comment.message || "";
}

function commentItem(comment, options = {}) {
  const topId = options.topId || "";
  // Label only when the direct parent is not the group's root: an orphaned
  // reply (parent deleted/rejected) or a reply-to-a-reply.
  const replyTo = comment.parentId && comment.parentId !== topId && comment.parentName ? comment.parentName : "";
  const className = ["comment-item", options.reply ? "comment-item--reply" : ""].filter(Boolean).join(" ");
  // A comment the model could not fit in one response stays in the source
  // language; offer a button so the visitor can translate just this one.
  const canTranslate = aiLang && aiSkipped.has(`comment:${comment.id}`) && !commentMessage(comment);
  return `
    <article class="${className}" data-comment-id="${esc(comment.id || "")}">
      ${replyTo ? `<p class="comment-item__reply-to">${esc(commentLabel("replyTo"))} @${esc(replyTo)}</p>` : ""}
      <div class="comment-item__head">
        <strong>${esc(comment.name || "")}</strong>
        <span>${esc(commentTime(comment.createdAt))}</span>
      </div>
      <p>${esc(commentMessage(comment))}</p>
      <small>${esc(commentLabel("ip"))}: ${esc(comment.ip || "unknown")} · ${esc(commentLabel("location"))}: ${esc(commentLocation(comment))}</small>
      <div class="comment-item__actions">
        <button class="btn btn--compact js-reply-comment" type="button" data-id="${esc(comment.id || "")}" data-name="${esc(comment.name || "")}">${esc(commentLabel("reply"))}</button>
        ${canTranslate ? `<button class="btn btn--compact js-translate-comment" type="button" data-id="${esc(comment.id || "")}">${esc(commentLabel("translate"))}</button>` : ""}
      </div>
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

// --- AI translation runtime -------------------------------------------------
// Languages marked `ai: true` in data.js have no static page. For those, every
// visible string — static copy, UI labels, placeholders/aria labels and comment
// bodies — is collected in the browser, translated in batches by Workers AI via
// /api/translate, cached in D1 by content hash, and applied only after every
// entry came back, so a page is never left half-translated.
const TRANSLATE_SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "CODE", "PRE", "KBD", "SAMP"]);
const TRANSLATE_ATTRS = ["placeholder", "aria-label", "title", "alt"];
// Worker caps: 80 items per request, 10 per model call, 64KB body. Groups also
// carry a byte budget so a batch of long entries can never exceed the body limit.
// TRANSLATE_ITEM_MAX_CHARS must stay equal to MAX_TRANSLATE_ITEM_CHARS in
// worker.js: when this was larger, the worker silently truncated the source and
// the page ended up showing a partial translation. A node over the cap is left
// in the source language rather than risk a half-translated page.
//
// 150 is the measured ceiling of the model's output budget (see the matching
// comment in worker.js), not a guess. A node over it is reported by the API in
// `skipped` and stays readable in the source language; long comments are
// translated on demand via the per-comment button instead.
const TRANSLATE_GROUP_SIZE = 80;
const TRANSLATE_GROUP_BYTES = 200000;
const TRANSLATE_ITEM_MAX_CHARS = 150;

function translateEligible(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > TRANSLATE_ITEM_MAX_CHARS) return "";
  // Numbers, dates and punctuation carry nothing to translate and would only
  // spend neurons, so they never leave the browser.
  if (!/[\p{L}]/u.test(text)) return "";
  return text;
}

// Returns entries (every id on the page) plus the de-duplicated items that are
// actually sent to the worker. Identical copy collapses to one request row and
// is then fanned back out to all of its ids.
function collectTranslationItems() {
  const entries = [];
  const byText = new Map();
  const add = (id, raw, target) => {
    const text = translateEligible(raw);
    if (!text) return;
    entries.push({ id, text, target });
    if (!byText.has(text)) byText.set(text, id);
  };

  // 1. Dictionaries first: keying them means anything rendered later through
  //    label()/commentLabel() (content cards, retry buttons, comment UI) is
  //    already translated instead of falling back to Chinese.
  for (const key of Object.keys(ui.zh || {})) add(`ui:${key}`, ui.zh[key]);
  for (const key of Object.keys(commentUi.zh || {})) add(`ui:comment:${key}`, commentUi.zh[key]);

  // 2. Comment bodies, keyed by id so a re-render keeps the translated text.
  const list = document.getElementById("commentList");
  for (const comment of commentsCache.comments || []) add(`comment:${comment.id}`, comment.message);

  // 3. Every visible text node except the comment list, which is already
  //    covered by the per-id entries above.
  let index = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const insideComments = list ? list.contains(node) : false;
    if (parent && !insideComments && !TRANSLATE_SKIP_TAGS.has(parent.tagName) && !parent.closest("[data-no-translate]")) {
      add(`n:${index}`, node.nodeValue, node);
      index += 1;
    }
    node = walker.nextNode();
  }

  // 4. Attributes that carry user-visible copy.
  let attrIndex = 0;
  document.querySelectorAll("[placeholder],[aria-label],[title],img[alt]").forEach((element) => {
    if (element.closest("[data-no-translate]")) return;
    for (const attr of TRANSLATE_ATTRS) {
      if (!element.hasAttribute(attr)) continue;
      add(`a:${attrIndex}:${attr}`, element.getAttribute(attr), { element, attr });
      attrIndex += 1;
    }
  });

  const items = [];
  for (const [text, id] of byText) items.push({ id, text });
  return { entries, items, byText };
}

async function requestTranslations(items) {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lang: aiLang, items }),
  });
  if (!response.ok) throw new Error(`translate responded HTTP ${response.status}`);
  const data = await response.json().catch(() => ({}));
  return data.translations || {};
}

// Groups items by count AND a rough UTF-8 byte budget so a batch full of long
// entries can never blow past the worker's 256KB body limit.
function groupTranslateItems(items) {
  const groups = [];
  let current = [];
  let bytes = 0;
  for (const item of items) {
    const cost = item.text.length * 3 + 64;
    if (current.length && (current.length >= TRANSLATE_GROUP_SIZE || bytes + cost > TRANSLATE_GROUP_BYTES)) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += cost;
  }
  if (current.length) groups.push(current);
  return groups;
}

function applyTranslations(entries) {
  if (!aiDict) return;
  for (const entry of entries) {
    const value = aiDict[entry.id];
    if (!value) continue;
    // Assigning to a text node / attribute is inherently safe: no HTML parsing.
    if (entry.target instanceof Node) entry.target.nodeValue = value;
    else if (entry.target?.element) entry.target.element.setAttribute(entry.target.attr, value);
  }
}

function waitFor(check, timeout = 2500) {
  if (check()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check() || Date.now() - started > timeout) {
        clearInterval(timer);
        resolve(check());
      }
    }, 100);
  });
}

function showTranslateBanner(text) {
  let banner = document.getElementById("translateBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "translateBanner";
    banner.className = "translate-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    document.body.append(banner);
  }
  banner.textContent = text;
  banner.hidden = false;
  return banner;
}

function hideTranslateBanner() {
  const banner = document.getElementById("translateBanner");
  if (banner) banner.hidden = true;
}

// A few strings may exceed what the model can return in one response. Say so
// quietly instead of letting the visitor assume the whole page is translated.
function noteUntranslated() {
  if (!aiSkipped.size) return;
  showTranslateBanner(ui.zh.translatePartial);
  setTimeout(hideTranslateBanner, 6000);
}

// `code` is the language whose copy is now on screen. Pass the source language
// (never "") when falling back to untranslated copy: resolving "" finds no
// language and would leave <html lang=""> — an invalid value that hurts SEO and
// screen readers.
function setDocumentDirection(code) {
  const entry = languages.find((item) => item.code === code);
  document.documentElement.lang = entry?.html || "zh-CN";
  // Arabic (and future RTL additions) need the writing direction flipped.
  document.documentElement.dir = code === "ar" || code === "he" || code === "fa" ? "rtl" : "ltr";
}

async function startAiTranslation() {
  if (!isAiLang(lang) || aiTranslationActive) return;
  aiTranslationActive = true;
  aiLang = lang;
  // The page still shows its source language, so the banner uses the source
  // dictionary on purpose (a translated banner would flash mixed copy).
  showTranslateBanner(ui.zh.translating);
  try {
    // Comments arrive from their own request; wait briefly so their text joins
    // the same batch instead of costing a second round trip.
    await waitFor(() => Array.isArray(commentsCache.comments), 2500);
    const { entries, items, byText } = collectTranslationItems();
    if (!items.length) {
      hideTranslateBanner();
      return;
    }

    const byId = {};
    let skipped = [];
    for (const group of groupTranslateItems(items)) {
      Object.assign(byId, await requestTranslations(group));
    }
    // Completeness gate: a single missing entry would leave the page mixing the
    // original and target languages, so show the original instead. Copy the
    // model cannot fit in its output budget is reported as skipped and is
    // exempt — one long string must not cost the visitor the whole page.
    const missingIds = items.filter((item) => !byId[item.id]).map((item) => item.id);
    if (missingIds.length && missingIds.length === items.length) throw new Error("incomplete translation");

    const dict = {};
    const textDict = {};
    for (const entry of entries) {
      const value = byId[byText.get(entry.text)];
      if (value) {
        dict[entry.id] = value;
        textDict[entry.text] = value;
      }
    }
    aiDict = dict;
    aiTextDict = textDict;
    aiSkipped = new Set(missingIds);
    applyTranslations(entries);
    setDocumentDirection(aiLang);
    const title = document.querySelector("title");
    if (title && aiDict["ui:siteTitle"]) title.textContent = aiDict["ui:siteTitle"];
    hideTranslateBanner();
    if (missingIds.length) noteUntranslated();
  } catch (error) {
    console.warn("[translate] falling back to the original copy", error?.message || error);
    aiLang = "";
    aiDict = null;
    aiTextDict = null;
    aiSkipped = new Set();
    // `lang` is still the AI language here; the document itself never left the
    // source language, so restore that (data-lang, else the /en/ /ja/ path).
    setDocumentDirection(normalizeLang(document.body.dataset.lang) || langFromPath() || "zh");
    showTranslateBanner(ui.zh.translateFailed);
    setTimeout(hideTranslateBanner, 6000);
  } finally {
    aiTranslationActive = false;
  }
}

// Incremental pass for content rendered after the first translation (comments
// that loaded late, anime/games/github cards): translate only text the shared
// text-level dictionary has never seen, then apply just the new entries.
async function translateNewContent() {
  if (!aiLang || aiTranslationActive || !aiTextDict) return;
  const { entries, items, byText } = collectTranslationItems();
  const missing = items.filter((item) => !aiTextDict[item.text]);
  if (!missing.length) {
    applyTranslations(entries);
    return;
  }
  try {
    const byId = {};
    for (const group of groupTranslateItems(missing)) {
      Object.assign(byId, await requestTranslations(group));
    }
    for (const entry of entries) {
      const value = byId[byText.get(entry.text)];
      if (value) {
        aiDict[entry.id] = value;
        aiTextDict[entry.text] = value;
      }
    }
    applyTranslations(entries);
    // Comment bodies render through commentMessage(), not as plain DOM entries,
    // so fresh comment translations need a re-render to show up.
    if (missing.some((item) => item.id.startsWith("comment:"))) {
      const list = liveCommentList(document.getElementById("commentList"));
      if (list && Array.isArray(commentsCache.comments)) renderComments(list, commentsCache.comments);
    }
  } catch {
    // Leave new content untranslated rather than disturbing the page.
  }
}

// --- Language selector ------------------------------------------------------
// zh/ja/en exist as real static pages (switch = navigate). AI languages have no
// page, so the current document is kept and translated in place.
function localeHref(code) {
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments[0] === "en" || segments[0] === "ja") segments.shift();
  const rest = segments.join("/");
  const base = root === "." ? "" : `${root}/`;
  if (code === "zh") return rest ? `${base}${rest}` : "./";
  return `${base}${code}/${rest}`;
}

function bindLangSelector() {
  const menu = document.querySelector(".lang-menu");
  if (!menu || menu.querySelector("#langSelect")) return;
  // The static shell hides this menu (it used to hold only a theme icon); a real
  // select must be reachable by keyboard and screen readers.
  menu.removeAttribute("aria-hidden");

  const select = document.createElement("select");
  select.id = "langSelect";
  select.className = "lang-select";
  select.setAttribute("aria-label", "Language");
  for (const item of languages) {
    const option = document.createElement("option");
    option.value = item.code;
    option.textContent = item.label;
    if (item.code === lang) option.selected = true;
    select.append(option);
  }
  select.addEventListener("change", () => {
    const code = select.value;
    storageSet(langKey, code);
    if (isAiLang(code)) window.location.reload();
    else window.location.assign(localeHref(code));
  });
  menu.prepend(select);
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
