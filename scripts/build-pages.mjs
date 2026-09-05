import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cities, contacts, homeCards, japanPlan, languages, profile, ui } from "../assets/js/data.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const assetVersion = "20260818-japan-travel";
const siteOrigin = "https://about.shuangyue.space";
const locales = [
  { code: "zh", prefix: "", html: "zh-CN" },
  { code: "en", prefix: "en", html: "en-US" },
  { code: "ja", prefix: "ja", html: "ja-JP" },
];

const allStops = [japanPlan, ...cities];

function t(lang, value) {
  if (value && typeof value === "object") return value[lang] || value.zh || "";
  return value ?? "";
}

function l(lang, key) {
  return ui[lang]?.[key] || ui.zh[key] || key;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function attr(value) {
  return esc(value).replaceAll('"', "&quot;");
}

function localePath(locale, path = "") {
  const base = locale.prefix ? `/${locale.prefix}/` : "/";
  return `${base}${path}`.replace(/\/{2,}/g, "/");
}

function relAsset(depth, path) {
  const prefix = depth === 0 ? "." : Array.from({ length: depth }, () => "..").join("/");
  return `${prefix}/${path}`.replace(/\/{2,}/g, "/");
}

function imageSrcset(depth, image) {
  if (!image || !image.endsWith(".png")) return "";
  const base = image.replace(/^assets\/images\//, "assets/images/generated/").replace(/\.png$/, "");
  return `${relAsset(depth, `${base}-480.webp`)} 480w, ${relAsset(depth, `${base}-960.webp`)} 960w`;
}

function generatedImage(depth, image, width) {
  const base = image.replace(/^assets\/images\//, "assets/images/generated/").replace(/\.png$/, "");
  return relAsset(depth, `${base}-${width}.webp`);
}

function localizedLinks(path) {
  return locales.map((locale) => ({
    hreflang: locale.html,
    href: `${siteOrigin}${localePath(locale, path)}`,
  }));
}

function stopDate(lang, stop) {
  if (stop.dateStatus === "pending") return l(lang, "datePending");
  if (stop.endDate) return `${stop.date.replaceAll("-", ".")} — ${stop.endDate.replaceAll("-", ".")}`;
  if (stop.planned) return lang === "en" ? "Summer 2026" : lang === "ja" ? "2026年夏" : "2026 年夏";
  return stop.date.replaceAll("-", ".");
}

function monthLabel(lang, stop) {
  if (stop.dateStatus === "pending") return l(lang, "supplementMonth");
  const [year, month] = stop.date.split("-");
  return lang === "en" ? `${year}.${month}` : `${year}年${month}月`;
}

function pageFrame({
  locale,
  depth,
  page,
  title,
  description,
  path,
  main,
  jsonLd,
  ogImage = "assets/images/generated/home-hero-ink-960.webp",
  ogImageAlt = "",
  ogImageWidth = 0,
  ogImageHeight = 0,
  preloadImages = [],
}) {
  const lang = locale.code;
  const css = relAsset(depth, `assets/css/styles.css?v=${assetVersion}`);
  const js = relAsset(depth, `assets/js/app.js?v=${assetVersion}`);
  const manifest = relAsset(depth, "manifest.webmanifest");
  const favicon = relAsset(depth, "assets/images/favicon-32.png");
  const touchIcon = relAsset(depth, "assets/images/icon-192.png");
  const canonical = `${siteOrigin}${localePath(locale, path)}`;
  const absoluteOgImage = `${siteOrigin}/${ogImage.replace(/^\//, "")}`;
  const alternates = localizedLinks(path);
  const rootAttr = depth === 0 ? "." : Array.from({ length: depth }, () => "..").join("/");
  const homePreloads = page === "home" ? [
    { href: "assets/images/generated/home-hero-ink-480.webp", media: "(max-width: 640px)" },
    { href: "assets/images/generated/home-hero-ink-960.webp", media: "(min-width: 641px) and (max-width: 920px)" },
    { href: "assets/images/generated/home-hero-ink-1600.webp", media: "(min-width: 921px)" },
  ] : [];
  const imagePreloads = [...homePreloads, ...preloadImages]
    .map((item) => {
      const candidates = item.candidates
        ?.map((candidate) => `${relAsset(depth, candidate.href)} ${candidate.width}w`)
        .join(", ");
      return `<link rel="preload" as="image" href="${attr(relAsset(depth, item.href))}" type="${attr(item.type || "image/webp")}"${candidates ? ` imagesrcset="${attr(candidates)}" imagesizes="${attr(item.sizes)}"` : ""}${item.media ? ` media="${attr(item.media)}"` : ""} fetchpriority="high">`;
    })
    .join("\n    ");
  const ogType = ogImage.endsWith(".webp") ? "image/webp" : ogImage.endsWith(".png") ? "image/png" : "";
  return `<!doctype html>
<html lang="${locale.html}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${attr(description)}">
    <meta name="theme-color" content="#35584a">
    <meta name="color-scheme" content="light dark">
    <script>try{const theme=localStorage.getItem("sfsy-theme");if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme}catch{}</script>
    <link rel="canonical" href="${attr(canonical)}">
    ${alternates.map((item) => `<link rel="alternate" hreflang="${attr(item.hreflang)}" href="${attr(item.href)}">`).join("\n    ")}
    <link rel="alternate" hreflang="x-default" href="${attr(`${siteOrigin}${localePath(locales[0], path)}`)}">
    <link rel="manifest" href="${attr(manifest)}">
    <link rel="icon" type="image/png" sizes="32x32" href="${attr(favicon)}">
    <link rel="apple-touch-icon" sizes="192x192" href="${attr(touchIcon)}">
    ${imagePreloads}
    <meta property="og:type" content="${page === "home" ? "profile" : page === "city" || page === "trip" ? "article" : "website"}">
    <meta property="og:site_name" content="朔风霜月">
    <meta property="og:title" content="${attr(title)}">
    <meta property="og:description" content="${attr(description)}">
    <meta property="og:url" content="${attr(canonical)}">
    <meta property="og:image" content="${attr(absoluteOgImage)}">
    <meta property="og:image:alt" content="${attr(ogImageAlt || l(lang, "shareText"))}">
    ${ogType ? `<meta property="og:image:type" content="${ogType}">` : ""}
    ${ogImageWidth ? `<meta property="og:image:width" content="${ogImageWidth}">` : ""}
    ${ogImageHeight ? `<meta property="og:image:height" content="${ogImageHeight}">` : ""}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${attr(title)}">
    <meta name="twitter:description" content="${attr(description)}">
    <meta name="twitter:image" content="${attr(absoluteOgImage)}">
    <meta name="twitter:image:alt" content="${attr(ogImageAlt || l(lang, "shareText"))}">
    <title>${esc(title)}</title>
    <link rel="stylesheet" href="${attr(css)}">
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body data-page="${attr(page)}" data-root="${attr(rootAttr)}" data-lang="${attr(lang)}"${page === "city" ? ` data-city="${attr(path.split("/").pop().replace(/\.html$/, ""))}"` : ""}>
    <div id="app">${main}</div>
    <noscript>${noscript(locale)}</noscript>
    <script type="module" src="${attr(js)}"></script>
  </body>
</html>
`;
}

function layout(locale, depth, page, content, currentPath = "") {
  const lang = locale.code;
  return `
    <a class="skip-link" href="#main-content">${esc(l(lang, "skipToContent"))}</a>
    <header class="topbar">
      <a class="brand" href="${attr(localePath(locale, ""))}">
        <span class="brand__mark brand__mark--avatar"><img src="${attr(profile.avatar)}" alt="${attr(l(lang, "avatarAlt"))}" width="36" height="36" decoding="async"></span>
        <span><span class="brand__name">${esc(l(lang, "heroTitle"))}</span><span class="brand__kicker">${esc(l(lang, "brandKicker"))}</span></span>
      </a>
      <nav class="topnav" aria-label="${attr(l(lang, "primaryNavigation"))}">
        <a href="${attr(localePath(locale, ""))}" ${page === "home" ? 'aria-current="page"' : ""}>${esc(l(lang, "navHome"))}</a>
        <a href="${attr(localePath(locale, "travel/"))}" ${page === "travel" ? 'aria-current="page"' : ""}>${esc(l(lang, "navTravel"))}</a>
        <a href="${attr(localePath(locale, "travel/#cities"))}">${esc(l(lang, "navCities"))}</a>
        <a href="${attr(page === "home" ? "#contact" : localePath(locale, "#contact"))}">${esc(l(lang, "navContact"))}</a>
      </nav>
      <div class="lang-menu" aria-label="${attr(l(lang, "language"))}">
        ${locales.map((item) => `<a class="lang-menu__item ${item.code === lang ? "is-active" : ""}" href="${attr(localePath(item, currentPath))}" hreflang="${attr(item.html)}"${item.code === lang ? ' aria-current="page"' : ""}>${esc(languages.find((candidate) => candidate.code === item.code)?.label || item.code)}</a>`).join("")}
        <button class="lang-menu__item js-theme" type="button" aria-label="${attr(l(lang, "toggleTheme"))}">◐</button>
      </div>
    </header>
    ${content}
    <div class="toast" id="pageToast" role="status" aria-live="polite" aria-atomic="true" hidden></div>
    <footer class="site-footer">
      <span>${esc(l(lang, "footerLeft"))}</span><span class="site-footer__sep">|</span>
      <span>${esc(l(lang, "footerRight"))}</span><span class="site-footer__sep">|</span>
      <a href="${attr(profile.githubUrl)}" target="_blank" rel="noopener noreferrer">GitHub ${esc(profile.githubUser)}</a>
    </footer>
  `;
}

function heroMetaText(lang) {
  const base = l(lang, "heroMeta");
  if (!profile.birthDate) return base;
  const born = new Date(profile.birthDate);
  if (Number.isNaN(born.getTime())) return base;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const beforeBirthday = now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  if (age <= 0) return base;
  if (lang === "en") return `${age} · ${base}`;
  if (lang === "ja") return `${age}歳 · ${base}`;
  return `${age} 岁 · ${base}`;
}

function homePage(locale) {
  const lang = locale.code;
  const depth = locale.prefix ? 1 : 0;
  const main = layout(locale, depth, "home", `
    <main id="main-content" tabindex="-1">
      <section class="hero hero--home" id="top">
        <div class="hero__painting" aria-hidden="true"></div>
        <div class="hero__content">
          <div class="avatar-ring"><img src="${attr(profile.avatar)}" alt="${attr(l(lang, "avatarAlt"))}" width="112" height="112" fetchpriority="high" decoding="async"></div>
          <p class="eyebrow">${esc(heroMetaText(lang))}</p>
          <h1>${esc(l(lang, "heroTitle"))}</h1>
          <p class="hero__subtitle">${esc(l(lang, "heroSubtitle"))}</p>
          <p class="hero__motto">${esc(l(lang, "homeMotto"))}</p>
          <div class="hero__actions">
            <a class="btn btn--primary js-download-contact" href="/contact.vcf" download>${esc(l(lang, "saveContact"))}<span aria-hidden="true">↓</span></a>
            <button class="btn js-share" type="button">${esc(l(lang, "shareCard"))}<span aria-hidden="true">↗</span></button>
            <a class="btn" href="${attr(localePath(locale, "travel/"))}">${esc(l(lang, "primaryCta"))}<span aria-hidden="true">→</span></a>
          </div>
        </div>
      </section>
      <section class="feature-section" aria-labelledby="home-sections">
        <h2 id="home-sections">${esc(l(lang, "sectionHome"))}</h2>
        <div class="feature-list">${homeCards.map((card, index) => homeCard(locale, depth, card, index)).join("")}</div>
      </section>
      <section class="contact-section" id="contact">
        <div class="section-heading"><p class="eyebrow">${esc(l(lang, "contactTitle"))}</p><h2>${esc(profile.githubUser)}</h2></div>
        <div class="contact-grid">${contacts.map((item) => contactItem(lang, depth, item)).join("")}
          <a class="contact-link js-download-contact" href="/contact.vcf" download><span>vCard</span><strong>${esc(l(lang, "saveContact"))}</strong><small>${esc(l(lang, "saveContactHint"))}</small></a>
        </div>
      </section>
      <section class="comments-section" id="comments" data-comments>
        <div class="section-heading"><p class="eyebrow">Comments</p><h2>${esc(lang === "en" ? "Leave a public note" : lang === "ja" ? "公開コメントを残す" : "留下公开留言")}</h2></div>
        <div class="comment-list" id="commentList" aria-live="polite"><p class="comment-list__empty">${esc(lang === "en" ? "Comments load after the anti-spam check is ready." : "评论会在防刷组件准备后加载。")}</p></div>
      </section>
    </main>`, "");
  return pageFrame({
    locale,
    depth,
    page: "home",
    title: l(lang, "siteTitle"),
    description: lang === "en" ? "Shuofeng Shuanyue's profile, social accounts, contact details, and travel footprints." : lang === "ja" ? "朔風霜月のプロフィール、SNS、連絡先、旅の足跡。" : "朔风霜月的个人主页，包含个人介绍、社交账号、联系方式与旅行足迹。",
    path: "",
    main,
    ogImage: "assets/images/og-card.webp",
    ogImageWidth: 1200,
    ogImageHeight: 630,
    jsonLd: personJson(locale),
  });
}

function homeCard(locale, depth, card, index) {
  const lang = locale.code;
  const image = card.image ? relAsset(depth, card.image) : "";
  const cssImage = card.image ? `/${card.image.replace(/^\/+/, "")}` : "";
  return `
    <article class="feature-card feature-card--${index % 2 === 0 ? "image-left" : "image-right"}">
      <div class="ink-art ink-art--${attr(card.art)}" style="--ink-art-image: url(${attr(cssImage)});">
        <picture><source type="image/webp" srcset="${attr(imageSrcset(depth, card.image))}" sizes="(max-width: 920px) 100vw, 50vw"><img src="${attr(image)}" alt="${attr(t(lang, card.title))}" loading="lazy" width="960" height="530"></picture>
      </div>
      <div class="feature-card__text">
        <p class="eyebrow">${esc(l(lang, `${card.key}Title`))}</p>
        <h3>${esc(t(lang, card.title))}</h3>
        <p>${esc(t(lang, card.body))}</p>
        <div class="tag-row">${(card.tags[lang] || card.tags.zh).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>
      </div>
    </article>`;
}

function contactItem(lang, depth, item) {
  const descriptions = {
    qq: { zh: "点击复制 QQ 号", ja: "QQ番号をコピー", en: "Click to copy QQ number" },
    telegram: { zh: "点击打开 Telegram 会话", ja: "Telegramを開く", en: "Open a Telegram chat" },
    email: { zh: "点击发送电子邮件", ja: "メールを送る", en: "Send an email" },
    github: { zh: "查看代码与项目", ja: "コードとプロジェクトを見る", en: "View code and projects" },
    steam: { zh: "打开 Steam 个人资料", ja: "Steamプロフィールを開く", en: "Open Steam profile" },
  };
  const desc = descriptions[item.key]?.[lang] || descriptions[item.key]?.zh || "";
  if (item.type === "copy") {
    return `<button class="contact-link js-copy" type="button" data-copy="${attr(item.value)}"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong><small>${esc(desc)}</small></button>`;
  }
  return `<a class="contact-link" href="${attr(item.href)}" target="_blank" rel="noopener noreferrer"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong><small>${esc(desc)}</small></a>`;
}

function travelPage(locale) {
  const lang = locale.code;
  const depth = locale.prefix ? 2 : 1;
  const groups = cities.reduce((acc, city) => {
    const key = monthLabel(lang, city);
    acc[key] ||= [];
    acc[key].push(city);
    return acc;
  }, {});
  const latest = cities[0];
  const dated = cities.filter((city) => city.dateStatus === "visited" && String(city.date || "") !== "0000-00-00").length;
  const pending = cities.filter((city) => city.dateStatus === "pending").length;
  const main = layout(locale, depth, "travel", `
    <main id="main-content" tabindex="-1">
      <section class="travel-hero">
        <div class="travel-hero__text"><p class="eyebrow">${esc(l(lang, "travelTitle"))}</p><h1>${esc(l(lang, "totalCities"))} <span>${cities.length}</span> ${esc(l(lang, "cityUnit"))}</h1><p>${esc(l(lang, "travelIntro"))}</p></div>
        <div class="travel-stats">
          <a class="stat-card" href="${attr(localePath(locale, `cities/${latest.slug}.html`))}"><span>${esc(l(lang, "latest"))}</span><strong>${esc(t(lang, latest.name))}</strong><small>${esc(stopDate(lang, latest))}</small></a>
          <a class="stat-card stat-card--seal" href="${attr(localePath(locale, "cities/japan-2026.html"))}"><span>${esc(l(lang, "upcoming"))}</span><strong>${esc(t(lang, japanPlan.name))}</strong><small>${esc(stopDate(lang, japanPlan))} · ${esc(l(lang, "posterCount"))}</small></a>
          <div class="stat-card stat-card--breakdown"><span>${esc(l(lang, "statsDated"))}</span><strong>${dated}</strong><small>${esc(l(lang, "cityUnit"))}</small></div>
          <div class="stat-card stat-card--breakdown"><span>${esc(l(lang, "statsPending"))}</span><strong>${pending}</strong><small>${esc(l(lang, "cityUnit"))}</small></div>
        </div>
      </section>
      <section class="travel-search" id="cities"><label><span>${esc(l(lang, "allCities"))}</span><input type="search" id="citySearch" autocomplete="off" placeholder="${attr(l(lang, "searchPlaceholder"))}"></label></section>
      <section class="timeline" id="timeline">
        ${Object.entries(groups).map(([month, items]) => `<div class="timeline-group" data-month="${attr(month)}"><h2>${esc(month)}</h2><div class="city-list">${items.map((city) => cityPreview(locale, depth, city)).join("")}</div></div>`).join("")}
        <p class="no-results" hidden>${esc(l(lang, "noResults"))}</p>
      </section>
    </main>`, "travel/");
  return pageFrame({
    locale,
    depth,
    page: "travel",
    title: `${l(lang, "travelTitle")} | ${l(lang, "heroTitle")}`,
    description: lang === "en"
      ? `A timeline of ${cities.length} cities and a fifteen-day Japan travelogue from summer 2026.`
      : lang === "ja"
        ? `${cities.length}都市のタイムラインと、2026年夏の15日間の日本旅行記。`
        : `按时间轴记录 ${cities.length} 座城市，以及 2026 年夏的十五日日本旅记。`,
    path: "travel/",
    main,
    jsonLd: travelJson(locale),
  });
}

function cityPreview(locale, depth, city) {
  const lang = locale.code;
  const searchable = [t(lang, city.name), t(lang, city.region), t(lang, city.summary), t(lang, city.landmark), t(lang, city.food), ...city.tags.map((tag) => t(lang, tag))].join(" ");
  return `<a class="city-preview" href="${attr(localePath(locale, `cities/${city.slug}.html`))}" data-search="${attr(searchable.toLowerCase())}" aria-label="${attr(`${t(lang, city.name)} · ${stopDate(lang, city)}`)}">${cityVisual(locale, depth, city, "thumb")}<span class="city-preview__body"><strong>${esc(t(lang, city.name))}</strong><small>${esc(stopDate(lang, city))} · ${esc(t(lang, city.landmark))}</small><em>${esc(t(lang, city.highlight))}</em></span></a>`;
}

function cityPage(locale, stop) {
  if (stop.slug === "japan-2026" && Array.isArray(stop.posters)) return japanTripPage(locale, stop);
  const lang = locale.code;
  const depth = locale.prefix ? 2 : 1;
  const description = t(lang, stop.summary);
  const main = layout(locale, depth, "city", `
    <main id="main-content" tabindex="-1">
      <section class="city-hero city-hero--${attr(stop.theme)}">
        ${cityVisual(locale, depth, stop, "large")}
        <div class="city-hero__text"><a class="back-link" href="${attr(localePath(locale, "travel/"))}">← ${esc(l(lang, "backTravel"))}</a><p class="eyebrow">${esc(t(lang, stop.region))} · ${esc(stop.planned ? l(lang, "plan") : l(lang, "visitedOn"))}</p><h1>${esc(t(lang, stop.name))}</h1><p>${esc(description)}</p></div>
      </section>
      <section class="city-details"><div class="detail-panel"><span>${esc(l(lang, "visitedOn"))}</span><strong>${esc(stopDate(lang, stop))}</strong></div><div class="detail-panel"><span>${esc(l(lang, "region"))}</span><strong>${esc(t(lang, stop.region))}</strong></div><div class="detail-panel detail-panel--wide"><span>${esc(l(lang, "highlights"))}</span><div class="tag-row">${stop.tags.map((tag) => `<span>${esc(t(lang, tag))}</span>`).join("")}</div></div></section>
      <section class="city-story"><div class="section-heading"><p class="eyebrow">${esc(l(lang, "highlights"))}</p><h2>${esc(t(lang, stop.highlight))}</h2></div><div class="story-grid">${["scenery", "food", "culture"].map((key, index) => `<article><span>${esc(l(lang, key))}</span><h3>${esc(t(lang, stop.tags[index] || stop.name))}</h3><p>${esc(t(lang, stop.notes?.[key] || stop.highlight))}</p></article>`).join("")}</div></section>
    </main>`, `cities/${stop.slug}.html`);
  return pageFrame({
    locale,
    depth,
    page: "city",
    title: `${t(lang, stop.name)} | ${l(lang, "heroTitle")}`,
    description,
    path: `cities/${stop.slug}.html`,
    main,
    ogImage: stop.visual?.image || "assets/images/home-hero-ink.png",
    jsonLd: cityJson(locale, stop),
  });
}

function japanTripPage(locale, trip) {
  const lang = locale.code;
  const depth = locale.prefix ? 2 : 1;
  const description = t(lang, trip.summary);
  const tripTitle = t(lang, trip.name);
  const tripTitleParts = tripTitle.split(" · ");
  const tripTitleMarkup = tripTitleParts.length > 1
    ? `<span class="trip-title__part">${esc(tripTitleParts[0])} ·</span> <span class="trip-title__part">${esc(tripTitleParts.slice(1).join(" · "))}</span>`
    : esc(tripTitle);
  const firstPoster = trip.posters[0];
  const firstPosterSrc = generatedImage(depth, firstPoster.image, 960);
  const routeIntro = lang === "en"
    ? "Follow the journey in order: Tokyo, the lakes and coast, Kansai, then the flight home."
    : lang === "ja"
      ? "東京、湖と海辺、関西、そして帰路へ。日付順に4章でたどります。"
      : "从东京出发，经过湖岸与海边，再走入关西，最后沿着返程机翼收束全篇。";
  const footerNote = lang === "en"
    ? "Fifteen days become fifteen quiet paper records—each scene kept in the order it happened."
    : lang === "ja"
      ? "15日間を15枚の静かな紙の記録に。風景は旅が起きた順に並んでいます。"
      : "十五天被收成十五张安静的纸上记录，所有风景都按它发生的顺序留下。";
  const main = layout(locale, depth, "trip", `
    <main class="trip-page" id="main-content" tabindex="-1">
      <section class="trip-hero" aria-labelledby="trip-title">
        <div class="trip-hero__poster">
          <picture><source type="image/webp" srcset="${attr(imageSrcset(depth, firstPoster.image))}" sizes="(max-width: 920px) min(calc(100vw - 112px), 400px), 360px"><img src="${attr(firstPosterSrc)}" alt="${attr(t(lang, firstPoster.alt))}" width="1440" height="1800" decoding="async" fetchpriority="high"></picture>
        </div>
        <div class="trip-hero__content">
          <a class="trip-back-link" href="${attr(localePath(locale, "travel/"))}">← ${esc(l(lang, "backTravel"))}</a>
          <p class="trip-kicker">${esc(t(lang, trip.region))} · ${esc(l(lang, "plan"))}</p>
          <h1 id="trip-title">${tripTitleMarkup}</h1>
          <p class="trip-summary">${esc(description)}</p>
          <dl class="trip-meta">
            <div class="trip-meta__item"><dt>${esc(l(lang, "tripPeriod"))}</dt><dd><time datetime="${attr(trip.date)}">${esc(trip.date.replaceAll("-", "."))}</time><br><time datetime="${attr(trip.endDate)}">${esc(trip.endDate.replaceAll("-", "."))}</time></dd></div>
            <div class="trip-meta__item"><dt>${esc(l(lang, "tripChapters"))}</dt><dd>${esc(String(trip.chapters.length))}</dd></div>
            <div class="trip-meta__item"><dt>${esc(l(lang, "posterArchive"))}</dt><dd>${esc(l(lang, "posterCount"))}</dd></div>
          </dl>
        </div>
      </section>
      <section class="trip-route" aria-labelledby="trip-route-title">
        <div class="trip-route__header"><div><h2 id="trip-route-title">${esc(l(lang, "tripChapters"))}</h2><p>${esc(routeIntro)}</p></div>
          <nav class="trip-route__nav" aria-label="${attr(l(lang, "tripChapters"))}">${trip.chapters.map((chapter) => `<a href="#chapter-${attr(chapter.id)}">${esc(t(lang, chapter.title))}</a>`).join("")}</nav>
        </div>
        <ol class="trip-route__stops" aria-label="${attr(l(lang, "routeTitle"))}">
          <li class="trip-route__stop"><span class="trip-route__dot" aria-hidden="true">01</span><span class="trip-route__stop-text"><strong>${esc(l(lang, "routeStopTokyo"))}</strong><small>${esc(l(lang, "routeStopTokyoNote"))}</small></span></li>
          <li class="trip-route__stop"><span class="trip-route__dot" aria-hidden="true">02</span><span class="trip-route__stop-text"><strong>${esc(l(lang, "routeStopFuji"))}</strong><small>${esc(l(lang, "routeStopFujiNote"))}</small></span></li>
          <li class="trip-route__stop"><span class="trip-route__dot" aria-hidden="true">03</span><span class="trip-route__stop-text"><strong>${esc(l(lang, "routeStopAtami"))}</strong><small>${esc(l(lang, "routeStopAtamiNote"))}</small></span></li>
          <li class="trip-route__stop"><span class="trip-route__dot" aria-hidden="true">04</span><span class="trip-route__stop-text"><strong>${esc(l(lang, "routeStopKansai"))}</strong><small>${esc(l(lang, "routeStopKansaiNote"))}</small></span></li>
        </ol>
      </section>
      ${trip.chapters.map((chapter) => tripChapter(locale, depth, trip, chapter)).join("")}
      <div class="trip-footer"><p>${esc(footerNote)}</p><a class="trip-back-link" href="${attr(localePath(locale, "travel/"))}">← ${esc(l(lang, "backTravel"))}</a></div>
    </main>`, `cities/${trip.slug}.html`);
  return pageFrame({
    locale,
    depth,
    page: "trip",
    title: `${t(lang, trip.name)} | ${l(lang, "heroTitle")}`,
    description,
    path: `cities/${trip.slug}.html`,
    main,
    ogImage: `assets/images/generated/${firstPoster.image.replace(/^assets\/images\//, "").replace(/\.png$/, "-1440.webp")}`,
    ogImageAlt: t(lang, firstPoster.alt),
    ogImageWidth: 1440,
    ogImageHeight: 1800,
    preloadImages: [{
      href: `assets/images/generated/${firstPoster.image.replace(/^assets\/images\//, "").replace(/\.png$/, "-480.webp")}`,
      candidates: [
        { href: `assets/images/generated/${firstPoster.image.replace(/^assets\/images\//, "").replace(/\.png$/, "-480.webp")}`, width: 480 },
        { href: `assets/images/generated/${firstPoster.image.replace(/^assets\/images\//, "").replace(/\.png$/, "-960.webp")}`, width: 960 },
      ],
      sizes: "(max-width: 920px) min(calc(100vw - 112px), 400px), 360px",
    }],
    jsonLd: tripJson(locale, trip),
  });
}

function tripChapter(locale, depth, trip, chapter) {
  const lang = locale.code;
  const posters = trip.posters.filter((poster) => poster.chapter === chapter.id);
  return `<section class="trip-chapter" id="chapter-${attr(chapter.id)}" aria-labelledby="chapter-${attr(chapter.id)}-title">
    <div class="trip-chapter__header"><h2 class="trip-chapter__heading" id="chapter-${attr(chapter.id)}-title">${esc(t(lang, chapter.title))}</h2><p class="trip-chapter__intro">${esc(t(lang, chapter.summary))}</p></div>
    <ol class="poster-gallery" start="${trip.posters.indexOf(posters[0]) + 1}">${posters.map((poster) => posterFigure(locale, depth, trip, poster)).join("")}</ol>
  </section>`;
}

function posterFigure(locale, depth, trip, poster) {
  const lang = locale.code;
  const index = trip.posters.indexOf(poster) + 1;
  const number = String(index).padStart(2, "0");
  const image = generatedImage(depth, poster.image, 960);
  const fullImage = generatedImage(depth, poster.image, 1440);
  return `<li><figure class="poster-card"><a class="poster-card__link" href="${attr(fullImage)}" aria-label="${attr(`${t(lang, poster.place)} · ${poster.date} · ${t(lang, poster.label)}`)}">
    <span class="poster-media"><picture><source type="image/webp" srcset="${attr(imageSrcset(depth, poster.image))}" sizes="(max-width: 640px) calc(100vw - 30px), (max-width: 920px) 44vw, 340px"><img src="${attr(image)}" alt="${attr(t(lang, poster.alt))}" loading="lazy" decoding="async" width="1440" height="1800"></picture></span>
  </a><figcaption class="poster-card__caption"><span class="poster-card__index">${esc(l(lang, "dayLabel"))} ${number} · ${esc(t(lang, poster.label))}</span><h3 class="poster-card__title">${esc(t(lang, poster.place))}</h3><span class="poster-card__meta"><time datetime="${attr(poster.date)}">${esc(poster.date.replaceAll("-", "."))}</time></span><p class="poster-card__note">${esc(t(lang, poster.summary))}</p></figcaption></figure></li>`;
}

function cityVisual(locale, depth, city, size) {
  const lang = locale.code;
  const visual = city.visual || {};
  const image = visual.image ? relAsset(depth, visual.image) : "";
  const cssImage = visual.image ? `/${visual.image.replace(/^\/+/, "")}` : "";
  const title = t(lang, city.landmark || city.name);
  return `<span class="city-visual city-visual--${attr(size)} city-visual--${attr(visual.shape || "plain")} ${image ? "city-visual--with-image" : ""}" style="--city-accent: ${attr(visual.accent || "#35584a")}; --city-image: url(${attr(cssImage)});">${image ? `<picture><source type="image/webp" srcset="${attr(imageSrcset(depth, visual.image))}" sizes="${size === "large" ? "(max-width: 920px) 100vw, 45vw" : "178px"}"><img class="city-visual__image" src="${attr(image)}" alt="${attr(title)}" loading="lazy" width="960" height="530"></picture>` : ""}<span class="city-visual__wash"></span><span class="city-visual__caption">${esc(title)}</span><span class="city-visual__region">${esc(t(lang, city.region))}</span></span>`;
}

function noscript(locale) {
  const lang = locale.code;
  const message = lang === "en"
    ? "The profile and contact links above remain available without JavaScript. Live comments and sharing enhancements are unavailable."
    : lang === "ja"
      ? "JavaScriptがなくても、上のプロフィールと連絡先は利用できます。コメントと共有機能のみ利用できません。"
      : "即使 JavaScript 未加载，上方个人资料、社交链接和通讯录下载仍可使用；仅实时留言与分享增强不可用。";
  return `<p class="noscript-fallback">${esc(message)}</p>`;
}

function personJson(locale) {
  const lang = locale.code;
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: l(lang, "siteTitle"),
    mainEntity: {
      "@type": "Person",
      name: l(lang, "heroTitle"),
      alternateName: profile.githubUser,
      email: profile.email,
      image: `${siteOrigin}${profile.avatar}`,
      url: `${siteOrigin}${localePath(locale, "")}`,
      sameAs: [profile.githubUrl, profile.telegram, profile.steam],
    },
  };
}

function travelJson(locale) {
  const lang = locale.code;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: l(lang, "travelTitle"),
    url: `${siteOrigin}${localePath(locale, "travel/")}`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: cities.length,
      itemListElement: cities.slice(0, 20).map((city, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${siteOrigin}${localePath(locale, `cities/${city.slug}.html`)}`,
        name: t(lang, city.name),
      })),
    },
  };
}

function cityJson(locale, city) {
  const lang = locale.code;
  return {
    "@context": "https://schema.org",
    "@type": "Place",
    name: t(lang, city.name),
    description: t(lang, city.summary),
    url: `${siteOrigin}${localePath(locale, `cities/${city.slug}.html`)}`,
  };
}

function tripJson(locale, trip) {
  const lang = locale.code;
  const url = `${siteOrigin}${localePath(locale, `cities/${trip.slug}.html`)}`;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t(lang, trip.name),
    description: t(lang, trip.summary),
    url,
    datePublished: trip.endDate,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: trip.posters.length,
      itemListElement: trip.posters.map((poster, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: t(lang, poster.place),
        description: t(lang, poster.summary),
        item: {
          "@type": "ImageObject",
          contentUrl: `${siteOrigin}/${poster.image.replace(/^assets\/images\//, "assets/images/generated/").replace(/\.png$/, "-1440.webp")}`,
          caption: t(lang, poster.alt),
          dateCreated: poster.date,
        },
      })),
    },
  };
}

async function writePage(path, html) {
  const file = resolve(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html.replace(/[ \t]+$/gm, ""), "utf8");
}

for (const locale of locales) {
  await writePage(locale.prefix ? `${locale.prefix}/index.html` : "index.html", homePage(locale));
  await writePage(locale.prefix ? `${locale.prefix}/travel/index.html` : "travel/index.html", travelPage(locale));
  for (const stop of allStops) {
    await writePage(locale.prefix ? `${locale.prefix}/cities/${stop.slug}.html` : `cities/${stop.slug}.html`, cityPage(locale, stop));
  }
}

const sitemapUrls = locales.flatMap((locale) => [
  `${siteOrigin}${localePath(locale, "")}`,
  `${siteOrigin}${localePath(locale, "travel/")}`,
  ...allStops.map((stop) => `${siteOrigin}${localePath(locale, `cities/${stop.slug}.html`)}`),
]);
await writePage("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((url) => `  <url><loc>${esc(url)}</loc></url>`).join("\n")}
</urlset>`);

console.log(`Generated ${locales.length * (allStops.length + 2)} localized pages`);
