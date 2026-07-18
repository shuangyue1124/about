import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cities, contacts, homeCards, japanPlan, languages, profile, ui } from "../assets/js/data.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const assetVersion = "20260719-nfc-card";
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

function localizedLinks(path) {
  return locales.map((locale) => ({
    hreflang: locale.html,
    href: `${siteOrigin}${localePath(locale, path)}`,
  }));
}

function stopDate(lang, stop) {
  if (stop.dateStatus === "pending") return l(lang, "datePending");
  if (stop.planned) return lang === "en" ? "Summer 2026 (planned from 2026-07-01)" : lang === "ja" ? "2026年夏（2026-07-01 予定）" : "2026 年暑假（计划日期 2026-07-01）";
  return stop.date.replaceAll("-", ".");
}

function monthLabel(lang, stop) {
  if (stop.dateStatus === "pending") return l(lang, "supplementMonth");
  const [year, month] = stop.date.split("-");
  return lang === "en" ? `${year}.${month}` : `${year}年${month}月`;
}

function pageFrame({ locale, depth, page, title, description, path, main, jsonLd, ogImage = "assets/images/generated/home-hero-ink-960.webp" }) {
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
    ${page === "home" ? `<link rel="preload" as="image" href="${attr(relAsset(depth, "assets/images/generated/home-hero-ink-960.webp"))}" type="image/webp" media="(max-width: 920px)" fetchpriority="high">
    <link rel="preload" as="image" href="${attr(relAsset(depth, "assets/images/generated/home-hero-ink-1600.webp"))}" type="image/webp" media="(min-width: 921px)" fetchpriority="high">` : ""}
    <meta property="og:type" content="${page === "home" ? "profile" : page === "city" ? "article" : "website"}">
    <meta property="og:site_name" content="朔风霜月">
    <meta property="og:title" content="${attr(title)}">
    <meta property="og:description" content="${attr(description)}">
    <meta property="og:url" content="${attr(canonical)}">
    <meta property="og:image" content="${attr(absoluteOgImage)}">
    <meta property="og:image:alt" content="${attr(l(lang, "shareText"))}">
    ${page === "home" ? `<meta property="og:image:type" content="image/webp">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">` : ""}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${attr(title)}">
    <meta name="twitter:description" content="${attr(description)}">
    <meta name="twitter:image" content="${attr(absoluteOgImage)}">
    <meta name="twitter:image:alt" content="${attr(l(lang, "shareText"))}">
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
      <nav class="topnav" aria-label="Primary">
        <a href="${attr(localePath(locale, ""))}" ${page === "home" ? 'aria-current="page"' : ""}>${esc(l(lang, "navHome"))}</a>
        <a href="${attr(localePath(locale, "travel/"))}" ${page === "travel" ? 'aria-current="page"' : ""}>${esc(l(lang, "navTravel"))}</a>
        <a href="${attr(localePath(locale, "travel/#cities"))}">${esc(l(lang, "navCities"))}</a>
        <a href="${attr(page === "home" ? "#contact" : localePath(locale, "#contact"))}">${esc(l(lang, "navContact"))}</a>
      </nav>
      <div class="lang-menu" aria-label="${attr(l(lang, "language"))}">
        ${locales.map((item) => `<a class="lang-menu__item ${item.code === lang ? "is-active" : ""}" href="${attr(localePath(item, currentPath))}" hreflang="${attr(item.html)}">${esc(languages.find((candidate) => candidate.code === item.code)?.label || item.code)}</a>`).join("")}
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

function homePage(locale) {
  const lang = locale.code;
  const depth = locale.prefix ? 1 : 0;
  const main = layout(locale, depth, "home", `
    <main id="main-content" tabindex="-1">
      <section class="hero hero--home" id="top">
        <div class="hero__painting" aria-hidden="true"></div>
        <div class="hero__content">
          <div class="avatar-ring"><img src="${attr(profile.avatar)}" alt="${attr(l(lang, "avatarAlt"))}" width="112" height="112" fetchpriority="high" decoding="async"></div>
          <p class="eyebrow">${esc(l(lang, "heroMeta"))}</p>
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
  const main = layout(locale, depth, "travel", `
    <main id="main-content" tabindex="-1">
      <section class="travel-hero">
        <div class="travel-hero__text"><p class="eyebrow">${esc(l(lang, "travelTitle"))}</p><h1>${esc(l(lang, "totalCities"))} <span>${cities.length}</span> ${esc(l(lang, "cityUnit"))}</h1><p>${esc(l(lang, "travelIntro"))}</p></div>
        <div class="travel-stats">
          <a class="stat-card" href="${attr(localePath(locale, `cities/${latest.slug}.html`))}"><span>${esc(l(lang, "latest"))}</span><strong>${esc(t(lang, latest.name))}</strong><small>${esc(stopDate(lang, latest))}</small></a>
          <a class="stat-card stat-card--seal" href="${attr(localePath(locale, "cities/japan-2026.html"))}"><span>${esc(l(lang, "upcoming"))}</span><strong>${esc(t(lang, japanPlan.name))}</strong><small>${esc(stopDate(lang, japanPlan))}</small></a>
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
    description: lang === "en" ? `A timeline of ${cities.length} visited cities and a Japan 2026 travel plan.` : `按时间轴记录 ${cities.length} 座城市与日本 2026 旅行计划。`,
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
