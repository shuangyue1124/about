import { cities, contacts, homeCards, japanPlan, languages, profile, ui } from "./data.js";

const app = document.getElementById("app");
const page = document.body.dataset.page || "home";
const root = document.body.dataset.root || ".";
const currentCitySlug = document.body.dataset.city || citySlugFromPath();
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

function text(value) {
  if (value && typeof value === "object") return value[lang] || value.zh || "";
  return value ?? "";
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

function citySlugFromPath() {
  const file = window.location.pathname.split("/").pop() || "";
  return file.replace(/\.html$/, "");
}

function siteUrl(path) {
  if (!path) return root === "." ? "./" : `${root}/`;
  return `${root}/${path}`.replace(/\/{2,}/g, "/").replace(/^\.\//, "");
}

function rootUrl(path) {
  if (!path) return root === "." ? "./" : `${root}/`;
  return root === "." ? path : `${root}/${path}`;
}

function pageLink(path = "", code = lang) {
  const prefix = code === "zh" ? "/" : `/${code}/`;
  return `${prefix}${path}`.replace(/\/{2,}/g, "/");
}

function pagePathFor(code) {
  if (page === "travel") return pageLink("travel/", code);
  if (page === "city") return pageLink(`cities/${currentCitySlug}.html`, code);
  return pageLink("", code);
}

function contactDescription(item) {
  const descriptions = {
    qq: { zh: "点击复制 QQ 号", ja: "QQ番号をコピー", en: "Click to copy QQ number" },
    telegram: { zh: "点击打开 Telegram 会话", ja: "Telegramを開く", en: "Open a Telegram chat" },
    email: { zh: "点击发送电子邮件", ja: "メールを送る", en: "Send an email" },
    github: { zh: "查看代码与项目", ja: "コードとプロジェクトを見る", en: "View code and projects" },
    steam: { zh: "打开 Steam 个人资料", ja: "Steamプロフィールを開く", en: "Open Steam profile" },
  };
  return descriptions[item.key]?.[lang] || descriptions[item.key]?.zh || "";
}

function imageSrcset(image) {
  if (!image || !image.endsWith(".png")) return "";
  const base = image.replace(/^assets\/images\//, "assets/images/generated/").replace(/\.png$/, "");
  return `${rootUrl(`${base}-480.webp`)} 480w, ${rootUrl(`${base}-960.webp`)} 960w`;
}

function imageAlt(value) {
  return text(value).replace(/[。.!！?？].*$/, "").slice(0, 80);
}

const provinceGlyphs = new Map([
  ["北京", "京"],
  ["天津", "津"],
  ["上海", "沪"],
  ["河北", "冀"],
  ["山西", "晋"],
  ["内蒙古", "蒙"],
  ["河南", "豫"],
  ["湖北", "鄂"],
  ["辽宁", "辽"],
  ["江苏", "苏"],
  ["山东", "鲁"],
  ["福建", "闽"],
  ["湖南", "湘"],
  ["陕西", "陕"],
  ["甘肃", "甘"],
  ["日本", "日"],
]);

function provinceGlyph(city) {
  const region = typeof city.region === "object" ? city.region.zh : city.region;
  return provinceGlyphs.get(region) || city.visual?.glyph || text(city.name).slice(0, 1);
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
    ip: "IP",
    location: "Location",
    unknownLocation: "Unknown location",
    time: "Time",
  },
};

function commentLabel(key) {
  return commentUi[lang]?.[key] || commentUi.zh[key] || key;
}

function fmtDate(date) {
  const [year, month, day] = date.split("-");
  if (lang === "en") return `${year}.${month}.${day}`;
  if (lang === "ja") return `${year}.${month}.${day}`;
  return `${year}.${month}.${day}`;
}

function monthLabel(date) {
  const [year, month] = date.split("-");
  if (lang === "en") return `${year}.${month}`;
  if (lang === "ja") return `${year}年${month}月`;
  return `${year}年${month}月`;
}

function stopDate(stop) {
  if (stop.dateStatus === "pending") return label("datePending");
  if (stop.endDate) return `${fmtDate(stop.date)} — ${fmtDate(stop.endDate)}`;
  if (stop.planned) return lang === "en" ? "Summer 2026" : lang === "ja" ? "2026年夏" : "2026 夏";
  return fmtDate(stop.date);
}

function stopMonthLabel(stop) {
  if (stop.dateStatus === "pending") return label("supplementMonth");
  return monthLabel(stop.date);
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render() {
  document.documentElement.lang = languages.find((item) => item.code === lang)?.html || "zh-CN";
  document.title = page === "home"
    ? settingText("documentTitle", label("siteTitle"))
    : `${label("travelTitle")} | ${settingText("title", label("heroTitle"))}`;

  if (page === "travel") {
    app.innerHTML = layout(renderTravel());
    bindCommon();
    bindTravelSearch();
    return;
  }

  if (page === "city") {
    app.innerHTML = layout(renderCity());
    bindCommon();
    return;
  }

  app.innerHTML = layout(renderHome());
  bindCommon();
}

function layout(main) {
  return `
    <a class="skip-link" href="#main-content">${esc(label("skipToContent"))}</a>
    <header class="topbar">
      <a class="brand" href="${esc(rootUrl(""))}">
        <span class="brand__mark brand__mark--avatar">
          <img src="${esc(profile.avatar)}" alt="${esc(label("avatarAlt"))}" width="36" height="36" decoding="async">
        </span>
        <span>
          <span class="brand__name">${esc(settingText("title", label("heroTitle")))}</span>
          <span class="brand__kicker">${esc(label("brandKicker"))}</span>
        </span>
      </a>
      <nav class="topnav" aria-label="${esc(label("primaryNavigation") || "Primary navigation")}">
        <a href="${esc(pageLink(""))}" ${page === "home" ? 'aria-current="page"' : ""}>${esc(label("navHome"))}</a>
        <a href="${esc(pageLink("travel/"))}" ${page === "travel" ? 'aria-current="page"' : ""}>${esc(label("navTravel"))}</a>
        <a href="${esc(pageLink("travel/#cities"))}">${esc(label("navCities"))}</a>
        <a href="${esc(page === "home" ? "#contact" : rootUrl("#contact"))}">${esc(label("navContact"))}</a>
      </nav>
      <div class="lang-menu" aria-label="${esc(label("language"))}">
        ${languages
          .map(
            (item) => `
              <a class="lang-menu__item ${item.code === lang ? "is-active" : ""}" href="${esc(pagePathFor(item.code))}" hreflang="${esc(item.html)}" ${item.code === lang ? 'aria-current="page"' : ""}>
                ${esc(item.label)}
              </a>
            `
          )
          .join("")}
        <button class="lang-menu__item js-theme" type="button" aria-label="${esc(label("toggleTheme") || "Toggle theme")}">◐</button>
      </div>
    </header>
    ${main}
    <div class="toast" id="pageToast" role="status" aria-live="polite" aria-atomic="true" hidden></div>
    <footer class="site-footer">
      <span>${esc(label("footerLeft"))}</span>
      <span class="site-footer__sep">|</span>
      <span>${esc(label("footerRight"))}</span>
      <span class="site-footer__sep">|</span>
      <a href="${esc(profile.githubUrl)}" target="_blank" rel="noopener noreferrer">GitHub ${esc(profile.githubUser)}</a>
    </footer>
  `;
}

function renderHome() {
  return `
    <main id="main-content" tabindex="-1">
      <section class="hero hero--home" id="top">
        <div class="hero__painting" aria-hidden="true"></div>
        <div class="hero__content">
          <div class="avatar-ring">
            <img src="${esc(profile.avatar)}" alt="${esc(label("avatarAlt"))}" width="112" height="112" fetchpriority="high" decoding="async">
          </div>
          <p class="eyebrow">${esc(label("heroMeta"))}</p>
          <h1>${esc(settingText("title", label("heroTitle")))}</h1>
          <p class="hero__subtitle">${esc(settingText("subtitle", label("heroSubtitle")))}</p>
          <p class="hero__motto">${esc(label("homeMotto"))}</p>
          ${terminal(profile.githubUrl, `${label("terminalPrompt")} open github.com/${profile.githubUser}`)}
          <div class="hero__actions">
            <a class="btn btn--primary js-download-contact" href="/contact.vcf" download>${esc(label("saveContact"))}<span aria-hidden="true">↓</span></a>
            <button class="btn js-share" type="button">${esc(label("shareCard"))}<span aria-hidden="true">↗</span></button>
            <a class="btn" href="${esc(pageLink("travel/"))}">${esc(label("primaryCta"))}<span aria-hidden="true">→</span></a>
          </div>
        </div>
      </section>

      <section class="feature-section" aria-labelledby="home-sections">
        <h2 id="home-sections">${esc(label("sectionHome"))}</h2>
        <div class="feature-list">
          ${homeCards.map((card, index) => homeCard(card, index)).join("")}
        </div>
      </section>

      ${renderCommentsSection()}

      <section class="contact-section" id="contact">
        <div class="section-heading">
          <p class="eyebrow">${esc(label("contactTitle"))}</p>
          <h2>${esc(profile.githubUser)}</h2>
        </div>
        <div class="contact-grid">
          ${contacts.map(contactItem).join("")}
          <a class="contact-link js-download-contact" href="/contact.vcf" download>
            <span>vCard</span>
            <strong>${esc(label("saveContact") || "Save Contact")}</strong>
            <small>${esc(label("saveContactHint") || "Save to contacts")}</small>
          </a>
        </div>
      </section>
    </main>
  `;
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

function terminal(copyText, shownText) {
  return `
    <div class="terminal" data-copy="${esc(copyText)}">
      <span class="terminal__cmd">${esc(shownText)}</span>
      <button class="terminal__copy js-copy" type="button" data-copy="${esc(copyText)}" aria-label="${esc(label("terminalLabel"))}">
        <span class="copy-icon" aria-hidden="true"></span>
        <span class="copy-state">${esc(label("terminalLabel"))}</span>
      </button>
    </div>
  `;
}

function homeCard(card, index) {
  const tags = card.tags[lang] || card.tags.zh;
  const hasArt = card.art && card.art !== "none";
  const image = card.image ? rootUrl(card.image) : "";
  const cssImage = card.image ? `/${card.image.replace(/^\/+/, "")}` : "";
  const imageStyle = cssImage ? ` style="--ink-art-image: url(${esc(cssImage)});"` : "";
  return `
    <article class="feature-card feature-card--${index % 2 === 0 ? "image-left" : "image-right"} ${hasArt ? "" : "feature-card--no-art"}">
      ${hasArt ? `
        <div class="ink-art ink-art--${card.art}"${imageStyle}>
          ${image ? `<picture><source type="image/webp" srcset="${esc(imageSrcset(card.image))}" sizes="(max-width: 920px) 100vw, 50vw"><img src="${esc(image)}" alt="${esc(imageAlt(card.title))}" loading="lazy" width="960" height="530"></picture>` : ""}
        </div>
      ` : ""}
      <div class="feature-card__text">
        <p class="eyebrow">${esc(label(`${card.key}Title`))}</p>
        <h3>${esc(text(card.title))}</h3>
        <p>${esc(text(card.body))}</p>
        <div class="tag-row">
          ${tags.map((tag) => `<span>${esc(tag)}</span>`).join("")}
        </div>
      </div>
    </article>
  `;
}

function contactItem(item) {
  const attrs = item.type === "copy"
    ? `button type="button" data-copy="${esc(item.value)}"`
    : `a href="${esc(item.href)}" target="_blank" rel="noopener noreferrer"`;
  const close = item.type === "copy" ? "button" : "a";
  const copyClass = item.type === "copy" ? " js-copy" : "";
  return `
    <${attrs} class="contact-link${copyClass}">
      <span>${esc(item.label)}</span>
      <strong>${esc(item.value)}</strong>
      <small>${esc(contactDescription(item))}</small>
    </${close}>
  `;
}

function renderTravel() {
  const groups = groupByMonth(cities);
  const latestCity = cities[0];
  return `
    <main id="main-content" tabindex="-1">
      <section class="travel-hero">
        <div class="travel-hero__text">
          <p class="eyebrow">${esc(label("travelTitle"))}</p>
          <h1>${esc(label("totalCities"))} <span>${cities.length}</span> ${esc(label("cityUnit"))}</h1>
          <p>${esc(label("travelIntro"))}</p>
        </div>
        <div class="travel-stats">
          <a class="stat-card" href="${esc(pageLink(`cities/${latestCity.slug}.html`))}">
            <span>${esc(label("latest"))}</span>
            <strong>${esc(text(latestCity.name))}</strong>
            <small>${esc(stopDate(latestCity))}</small>
          </a>
          <a class="stat-card stat-card--seal" href="${esc(pageLink("cities/japan-2026.html"))}">
            <span>${esc(label("upcoming"))}</span>
            <strong>${esc(text(japanPlan.name))}</strong>
            <small>${esc(stopDate(japanPlan))} · ${esc(label("posterCount"))}</small>
          </a>
        </div>
      </section>

      <section class="travel-search" id="cities">
        <label>
          <span>${esc(label("allCities"))}</span>
          <input type="search" id="citySearch" autocomplete="off" placeholder="${esc(label("searchPlaceholder"))}">
        </label>
      </section>

      <section class="timeline" id="timeline">
        ${Object.entries(groups)
          .map(
            ([month, items]) => `
              <div class="timeline-group" data-month="${esc(month)}">
                <h2>${esc(month)}</h2>
                <div class="city-list">
                  ${items.map(cityPreview).join("")}
                </div>
              </div>
            `
          )
          .join("")}
        <p class="no-results" hidden>${esc(label("noResults"))}</p>
      </section>
    </main>
  `;
}

function groupByMonth(items) {
  return items.reduce((groups, item) => {
    const key = stopMonthLabel(item);
    groups[key] ||= [];
    groups[key].push(item);
    return groups;
  }, {});
}

function cityPreview(city) {
  const searchable = [
    text(city.name),
    text(city.region),
    city.regionGroup,
    text(city.summary),
    text(city.landmark),
    text(city.food),
    city.dateStatus === "pending" ? label("datePending") : "",
    ...city.tags.map(text),
  ].join(" ");
  return `
    <a class="city-preview" href="${esc(pageLink(`cities/${city.slug}.html`))}" data-search="${esc(searchable.toLowerCase())}" aria-label="${esc(`${text(city.name)} · ${stopDate(city)} · ${text(city.landmark)}`)}">
      ${renderCityVisual(city, "thumb")}
      <span class="city-preview__body">
        <strong>${esc(text(city.name))}</strong>
        <small>${esc(stopDate(city))} · ${esc(text(city.landmark))}</small>
        <em>${esc(text(city.highlight))}</em>
      </span>
    </a>
  `;
}

function renderCity() {
  const stops = [japanPlan, ...cities];
  const city = stops.find((item) => item.slug === currentCitySlug) || cities[0];
  const index = stops.findIndex((item) => item.slug === city.slug);
  const prev = stops[index - 1];
  const next = stops[index + 1];
  const storyItems = cityStoryItems(city);
  const cityTitle = text(city.name);
  document.title = `${cityTitle} | ${settingText("title", label("heroTitle"))}`;

  return `
    <main id="main-content" tabindex="-1">
      <section class="city-hero city-hero--${esc(city.theme)}">
        ${renderCityVisual(city, "large")}
        <div class="city-hero__text">
          <a class="back-link" href="${esc(pageLink("travel/"))}">← ${esc(label("backTravel"))}</a>
          <p class="eyebrow">${esc(text(city.region))} · ${esc(city.planned ? label("plan") : city.dateStatus === "pending" ? label("datePending") : label("visitedOn"))}</p>
          <h1>${esc(cityTitle)}</h1>
          <p>${esc(text(city.summary))}</p>
          ${terminal(city.planned ? rootUrl("cities/japan-2026.html") : `${cityTitle} ${stopDate(city)}`, city.planned ? label("japanIntro") : `${stopDate(city)} · ${text(city.highlight)}`)}
        </div>
      </section>

      <section class="city-details">
        <div class="detail-panel">
          <span>${esc(label("visitedOn"))}</span>
          <strong>${esc(stopDate(city))}</strong>
        </div>
        <div class="detail-panel">
          <span>${esc(label("region"))}</span>
          <strong>${esc(text(city.region))}</strong>
        </div>
        <div class="detail-panel detail-panel--wide">
          <span>${esc(label("highlights"))}</span>
          <div class="tag-row">
            ${cityFacts(city).map((tag) => `<span>${esc(tag)}</span>`).join("")}
          </div>
        </div>
      </section>

      <section class="city-story">
        <div class="section-heading">
          <p class="eyebrow">${esc(label("highlights"))}</p>
          <h2>${esc(text(city.highlight))}</h2>
        </div>
        <div class="story-grid">
          ${storyItems
            .map(
              (item) => `
                <article>
                  <span>${esc(item.label)}</span>
                  <h3>${esc(item.title)}</h3>
                  <p>${esc(item.body)}</p>
                </article>
              `
            )
            .join("")}
        </div>
      </section>

      <nav class="city-pager" aria-label="City navigation">
        ${prev ? pagerLink(prev, label("prevCity")) : "<span></span>"}
        ${next ? pagerLink(next, label("nextCity")) : "<span></span>"}
      </nav>
    </main>
  `;
}

function renderCityVisual(city, size) {
  const visual = city.visual || {};
  const shape = visual.shape || "plain";
  const accent = visual.accent || "#35584a";
  const image = visual.image ? rootUrl(visual.image) : "";
  const cssImage = visual.image ? `/${visual.image.replace(/^\/+/, "")}` : "";
  const imageStyle = cssImage ? ` --city-image: url(${esc(cssImage)});` : "";
  const title = text(city.landmark || city.name);
  const food = text(city.food || city.tags?.[2] || "");
  const region = text(city.region);
  return `
    <span class="city-visual city-visual--${esc(size)} city-visual--${esc(shape)} ${image ? "city-visual--with-image" : ""}" style="--city-accent: ${esc(accent)};${imageStyle}">
      ${image ? `<picture><source type="image/webp" srcset="${esc(imageSrcset(visual.image))}" sizes="${size === "large" ? "(max-width: 920px) 100vw, 45vw" : "178px"}"><img class="city-visual__image" src="${esc(image)}" alt="${esc(title)}" loading="lazy" width="960" height="530"></picture>` : ""}
      <span class="city-visual__wash"></span>
      <span class="city-visual__caption">${esc(title)}</span>
      <span class="city-visual__food">${esc(food)}</span>
      <span class="city-visual__region">${esc(region)}</span>
    </span>
  `;
}

function cityFacts(city) {
  return [
    text(city.landmark),
    text(city.food),
    ...city.tags.map(text),
  ].filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index).slice(0, 5);
}

function cityStoryItems(city) {
  const notes = city.notes || {};
  const landmark = text(city.landmark || city.tags?.[0] || city.name);
  const food = text(city.food || city.tags?.[2] || city.name);
  const culture = city.tags?.map(text).find((item) => item && item !== landmark && item !== food) || text(city.region);
  return [
    {
      label: label("scenery"),
      title: landmark,
      body: text(notes.scenery || city.highlight),
    },
    {
      label: label("food"),
      title: food,
      body: text(notes.food || city.highlight),
    },
    {
      label: label("culture"),
      title: culture,
      body: text(notes.culture || city.highlight),
    },
  ];
}

function storyLine(city, tag, index) {
  if (city.planned) {
    const lines = {
      zh: ["把车窗外的夏天留给电车。", "把清晨的安静留给神社。", "把未确定的路线留给海风。"],
      ja: ["車窓の夏を電車に預けます。", "朝の静けさを神社に預けます。", "未定のルートを海風に預けます。"],
      en: ["Leave summer outside the window to the trains.", "Leave morning quiet to the shrines.", "Leave the open route to sea wind."],
    };
    return lines[lang][index] || lines.zh[index] || text(tag);
  }

  const prefix = {
    zh: ["风景从", "味道从", "故事从"],
    ja: ["風景は", "味は", "物語は"],
    en: ["The scenery begins with", "The taste begins with", "The story begins with"],
  };
  const suffix = {
    zh: "开始，落成这一页的城市印象。",
    ja: "から始まり、このページの都市印象になります。",
    en: "and settles into this page's city memory.",
  };
  return `${prefix[lang][index] || prefix.zh[index]} ${text(tag)} ${suffix[lang] || suffix.zh}`;
}

function pagerLink(city, labelText) {
  return `
    <a href="${esc(pageLink(`cities/${city.slug}.html`))}">
      <span>${esc(labelText)}</span>
      <strong>${esc(text(city.name))}</strong>
    </a>
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
  bindComments();
  bindThemeToggle();
  registerServiceWorker();
  trackPageView();
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
      if (!response.ok) throw new Error("comment failed");
      const data = await response.json().catch(() => ({}));
      form.reset();
      if (window.turnstile) window.turnstile.reset();
      if (status) status.textContent = data.status === "pending" ? commentLabel("pending") : commentLabel("success");
      await loadComments(list);
    } catch {
      if (status) status.textContent = commentLabel("error");
    } finally {
      submit.disabled = false;
    }
  });
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
