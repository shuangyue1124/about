import { cities, contacts, homeCards, japanPlan, languages, profile, ui } from "./data.js";

const app = document.getElementById("app");
const page = document.body.dataset.page || "home";
const root = document.body.dataset.root || ".";
const currentCitySlug = document.body.dataset.city || citySlugFromPath();
const langKey = "sfsy-lang";

let lang = normalizeLang(localStorage.getItem(langKey)) || detectLang();

function normalizeLang(value) {
  if (!value) return "";
  if (value.startsWith("ja")) return "ja";
  if (value.startsWith("en")) return "en";
  return "zh";
}

function detectLang() {
  return normalizeLang(navigator.language || navigator.userLanguage || "zh");
}

function text(value) {
  if (value && typeof value === "object") return value[lang] || value.zh || "";
  return value ?? "";
}

function label(key) {
  return ui[lang][key] || ui.zh[key] || key;
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
  document.title = page === "home" ? label("siteTitle") : `${label("travelTitle")} | ${label("heroTitle")}`;

  if (page === "travel") {
    app.innerHTML = layout(renderTravel());
    bindCommon();
    bindTravelSearch();
    return;
  }

  if (page === "city") {
    app.innerHTML = layout(renderCity());
    bindCommon();
    setupInkCanvas();
    return;
  }

  app.innerHTML = layout(renderHome());
  bindCommon();
  setupInkCanvas();
}

function layout(main) {
  return `
    <a class="skip-link" href="#main-content">${esc(label("skipToContent"))}</a>
    <header class="topbar">
      <a class="brand" href="${esc(rootUrl(""))}" aria-label="${esc(label("navHome"))}">
        <span class="brand__mark brand__mark--avatar">
          <img src="${esc(profile.avatar)}" alt="" loading="lazy">
        </span>
        <span>
          <span class="brand__name">${esc(label("heroTitle"))}</span>
          <span class="brand__kicker">${esc(label("brandKicker"))}</span>
        </span>
      </a>
      <nav class="topnav" aria-label="Primary">
        <a href="${esc(rootUrl(""))}" ${page === "home" ? 'aria-current="page"' : ""}>${esc(label("navHome"))}</a>
        <a href="${esc(rootUrl("travel/"))}" ${page === "travel" ? 'aria-current="page"' : ""}>${esc(label("navTravel"))}</a>
        <a href="${esc(rootUrl("travel/#cities"))}">${esc(label("navCities"))}</a>
        <a href="${esc(page === "home" ? "#contact" : rootUrl("#contact"))}">${esc(label("navContact"))}</a>
      </nav>
      <div class="lang-menu" aria-label="${esc(label("language"))}">
        ${languages
          .map(
            (item) => `
              <button class="lang-menu__item ${item.code === lang ? "is-active" : ""}" type="button" data-lang="${item.code}" aria-pressed="${item.code === lang ? "true" : "false"}">
                ${esc(item.label)}
              </button>
            `
          )
          .join("")}
      </div>
    </header>
    ${main}
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
        <canvas class="hero__mask" id="heroMask" aria-hidden="true"></canvas>
        <div class="hero__content">
          <div class="avatar-ring">
            <img src="${esc(profile.avatar)}" alt="QQ Avatar">
          </div>
          <p class="eyebrow">${esc(label("heroMeta"))}</p>
          <h1>${esc(label("heroTitle"))}</h1>
          <p class="hero__subtitle">${esc(label("heroSubtitle"))}</p>
          ${terminal(profile.githubUrl, `${label("terminalPrompt")} open github.com/${profile.githubUser}`)}
          <div class="hero__actions">
            <a class="btn btn--primary" href="${esc(rootUrl("travel/"))}">${esc(label("primaryCta"))}<span aria-hidden="true">→</span></a>
            <a class="btn" href="${esc(profile.githubUrl)}" target="_blank" rel="noopener noreferrer">${esc(label("secondaryCta"))}<span aria-hidden="true">→</span></a>
          </div>
        </div>
      </section>

      <section class="feature-section" aria-labelledby="home-sections">
        <h2 id="home-sections">${esc(label("sectionHome"))}</h2>
        <div class="feature-list">
          ${homeCards.map((card, index) => homeCard(card, index)).join("")}
        </div>
      </section>

      <section class="contact-section" id="contact">
        <div class="section-heading">
          <p class="eyebrow">${esc(label("contactTitle"))}</p>
          <h2>${esc(profile.githubUser)}</h2>
        </div>
        <div class="contact-grid">
          ${contacts.map(contactItem).join("")}
        </div>
      </section>
    </main>
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
  return `
    <article class="feature-card feature-card--${index % 2 === 0 ? "image-left" : "image-right"} ${hasArt ? "" : "feature-card--no-art"}">
      ${hasArt ? `
        <div class="ink-art ink-art--${card.art}" aria-hidden="true">
          <span></span>
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
          <a class="stat-card" href="${esc(rootUrl(`cities/${latestCity.slug}.html`))}">
            <span>${esc(label("latest"))}</span>
            <strong>${esc(text(latestCity.name))}</strong>
            <small>${esc(stopDate(latestCity))}</small>
          </a>
          <a class="stat-card stat-card--seal" href="${esc(rootUrl("cities/japan-2026.html"))}">
            <span>${esc(label("upcoming"))}</span>
            <strong>${esc(text(japanPlan.name))}</strong>
            <small>${esc(label("plan"))}</small>
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
    <a class="city-preview" href="${esc(rootUrl(`cities/${city.slug}.html`))}" data-search="${esc(searchable.toLowerCase())}" aria-label="${esc(`${text(city.name)} · ${stopDate(city)} · ${text(city.landmark)}`)}">
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
  document.title = `${cityTitle} | ${label("travelTitle")}`;

  return `
    <main id="main-content" tabindex="-1">
      <section class="city-hero city-hero--${esc(city.theme)}">
        ${renderCityVisual(city, "large")}
        <div class="city-hero__text">
          <a class="back-link" href="${esc(rootUrl("travel/"))}">← ${esc(label("backTravel"))}</a>
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
  const glyph = provinceGlyph(city);
  const accent = visual.accent || "#35584a";
  const title = text(city.landmark || city.name);
  const food = text(city.food || city.tags?.[2] || "");
  const region = text(city.region);
  return `
    <span class="city-visual city-visual--${esc(size)} city-visual--${esc(shape)}" style="--city-accent: ${esc(accent)};" aria-hidden="true">
      <span class="city-visual__wash"></span>
      <span class="city-visual__sun"></span>
      <span class="city-visual__scape">
        <span class="city-visual__line city-visual__line--one"></span>
        <span class="city-visual__line city-visual__line--two"></span>
        <span class="city-visual__mark" data-glyph="${esc(glyph)}"></span>
      </span>
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
    <a href="${esc(rootUrl(`cities/${city.slug}.html`))}">
      <span>${esc(labelText)}</span>
      <strong>${esc(text(city.name))}</strong>
    </a>
  `;
}

function bindCommon() {
  document.querySelectorAll(".lang-menu__item").forEach((button) => {
    button.addEventListener("click", () => {
      lang = button.dataset.lang;
      localStorage.setItem(langKey, lang);
      render();
    });
  });
  bindCopyButtons();
  bindAvatarFallback();
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
  const ok = document.execCommand("copy");
  input.remove();
  return ok;
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

function setupInkCanvas() {
  const hero = document.querySelector(".hero, .city-hero");
  const canvas = document.getElementById("heroMask");
  if (
    !hero ||
    !canvas ||
    !window.matchMedia("(hover: hover)").matches ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const stamps = [];
  let w = 0;
  let h = 0;
  let last = null;
  let running = false;

  function resize() {
    const rect = hero.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();
  }

  function add(x, y) {
    if (stamps.length > 120) stamps.shift();
    stamps.push({ x, y, born: performance.now(), r: 92 + Math.random() * 48 });
  }

  function trail(x, y) {
    if (!last) {
      add(x, y);
      last = { x, y };
      return;
    }
    const dx = x - last.x;
    const dy = y - last.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 18));
    for (let i = 1; i <= steps; i += 1) add(last.x + (dx * i) / steps, last.y + (dy * i) / steps);
    last = { x, y };
  }

  function paint() {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgb(252, 250, 248)";
    ctx.fillRect(0, 0, w, h);
  }

  function carve(stamp, alpha, radius) {
    const gradient = ctx.createRadialGradient(stamp.x, stamp.y, radius * 0.2, stamp.x, stamp.y, radius);
    gradient.addColorStop(0, `rgba(0,0,0,${0.9 * alpha})`);
    gradient.addColorStop(0.65, `rgba(0,0,0,${0.65 * alpha})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    for (let i = 0; i <= 28; i += 1) {
      const a = (i / 28) * Math.PI * 2;
      const wobble = 0.82 + 0.11 * Math.sin(a * 3 + stamp.r) + 0.07 * Math.sin(a * 8);
      const x = stamp.x + Math.cos(a) * radius * wobble;
      const y = stamp.y + Math.sin(a) * radius * wobble;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  function loop() {
    paint();
    ctx.globalCompositeOperation = "destination-out";
    const now = performance.now();
    for (let i = stamps.length - 1; i >= 0; i -= 1) {
      const age = (now - stamps[i].born) / 620;
      if (age >= 1) {
        stamps.splice(i, 1);
        continue;
      }
      carve(stamps[i], 1 - age * age, 10 + stamps[i].r * (1 - Math.pow(1 - age, 3)));
    }
    if (stamps.length) requestAnimationFrame(loop);
    else running = false;
  }

  function start() {
    if (!running) {
      running = true;
      requestAnimationFrame(loop);
    }
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  hero.addEventListener("mousemove", (event) => {
    const rect = hero.getBoundingClientRect();
    trail(event.clientX - rect.left, event.clientY - rect.top);
    start();
  });
  hero.addEventListener("mouseleave", () => {
    last = null;
  });
}

render();
