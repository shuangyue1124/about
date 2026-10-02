import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cities, contacts, homeCards, japanPlan, languages, profile, visualShapes } from "../assets/js/data.js";

const errors = [];
const fail = (message) => errors.push(message);
const LANGS = ["zh", "ja", "en"];
const ROOT = resolve(".");

function textOf(value, lang) {
  return value && typeof value === "object" ? String(value[lang] || "").trim() : String(value || "").trim();
}

// --- languages ---
// LANGS (zh/ja/en) are the statically generated pages; entries marked ai:true
// have no static page and are translated at runtime by Workers AI instead.
if (!Array.isArray(languages) || languages.length < LANGS.length) {
  fail(`languages 至少要有 ${LANGS.length} 种静态语言，当前 ${languages?.length}`);
} else {
  for (const lang of LANGS) {
    if (!languages.some((item) => item.code === lang)) fail(`languages 缺少 ${lang}`);
  }
  const seen = new Set();
  for (const item of languages) {
    if (!item?.code || !item?.label || !item?.html) fail(`languages 项缺少 code/label/html：${JSON.stringify(item)}`);
    if (seen.has(item.code)) fail(`languages 语言代码重复：${item.code}`);
    seen.add(item.code);
  }
  // AI languages must stay in sync with AI_LANGUAGES in worker.js, otherwise a
  // selectable language would be rejected by /api/translate.
  const aiCodes = languages.filter((item) => item.ai).map((item) => item.code);
  if (aiCodes.length) {
    const worker = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
    const block = worker.match(/const AI_LANGUAGES = new Map\(\[([\s\S]*?)\]\);/);
    const workerCodes = block ? [...block[1].matchAll(/\["([a-z]{2})"/g)].map((match) => match[1]) : [];
    const missing = aiCodes.filter((code) => !workerCodes.includes(code));
    const extra = workerCodes.filter((code) => !aiCodes.includes(code));
    if (missing.length) fail(`data.js 的 AI 语言未同步到 worker.js AI_LANGUAGES：${missing.join(", ")}`);
    if (extra.length) fail(`worker.js AI_LANGUAGES 未同步到 data.js languages：${extra.join(", ")}`);
  }

  // The per-item character cap lives in two files. When app.js allowed 2000 and
  // worker.js capped at 1000, copy in between was silently truncated, so the
  // page rendered a partial translation that was then cached for good.
  const appSource = readFileSync(new URL("../assets/js/app.js", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const appCap = appSource.match(/const TRANSLATE_ITEM_MAX_CHARS = (\d+);/)?.[1];
  const workerCap = workerSource.match(/const MAX_TRANSLATE_ITEM_CHARS = (\d+);/)?.[1];
  if (!appCap || !workerCap) fail("找不到翻译字符上限常量（app.js TRANSLATE_ITEM_MAX_CHARS / worker.js MAX_TRANSLATE_ITEM_CHARS）");
  else if (appCap !== workerCap) {
    fail(`翻译字符上限不一致：app.js=${appCap}，worker.js=${workerCap}（worker 会静默截断超限文本，导致译文不完整并被缓存）`);
  }

  // sw.js is hand-maintained, so its precache URLs drift from assetVersion.
  // A stale ?v= never matches the page's real request and the precache is a
  // silent no-op; check the query strings instead of trusting the edit.
  const buildPages = readFileSync(new URL("./build-pages.mjs", import.meta.url), "utf8");
  const assetVersion = buildPages.match(/const assetVersion = "([^"]+)";/)?.[1];
  const swSource = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  if (assetVersion) {
    if (!swSource.includes(`sfsy-static-v${assetVersion}`)) {
      fail(`sw.js CACHE_NAME 未同步 assetVersion（当前 ${assetVersion}）`);
    }
    for (const match of swSource.matchAll(/\/assets\/[^"]+\?v=([^"]+)"/g)) {
      if (match[1] !== assetVersion) {
        fail(`sw.js 预缓存资源版本过期：${match[0]}（应为 ${assetVersion}）`);
      }
    }
  }
}

// --- profile ---
// 联系敏感值已移至服务端 contact catalog（D1 + /api/site 按域名过滤），
// 前端 data.js 仅保留公开骨架，因此 email/qq 等不再是必填。
for (const field of ["nickname", "avatar", "githubUrl", "githubUser"]) {
  if (!String(profile[field] || "").trim()) fail(`profile.${field} 缺失`);
}
if ("email" in profile && profile.email && !String(profile.email).includes("@")) fail("profile.email 格式错误");
if (profile.birthDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate) || Number.isNaN(Date.parse(profile.birthDate))) {
    fail(`profile.birthDate 格式必须为 YYYY-MM-DD，当前 "${profile.birthDate}"`);
  }
}

// --- homeCards ---
const cardKeys = homeCards.map((card) => card.key);
if (new Set(cardKeys).size !== cardKeys.length) fail("homeCards.key 不唯一");
for (const card of homeCards) {
  for (const field of ["title", "body"]) {
    for (const lang of LANGS) {
      if (!textOf(card[field], lang)) fail(`homeCards[${card.key}].${field}.${lang} 缺失`);
    }
  }
  if (!card.tags || typeof card.tags !== "object") {
    fail(`homeCards[${card.key}].tags 缺失`);
  } else {
    for (const lang of LANGS) {
      if (!Array.isArray(card.tags[lang]) || card.tags[lang].length === 0 || card.tags[lang].some((tag) => !String(tag || "").trim())) {
        fail(`homeCards[${card.key}].tags.${lang} 缺失`);
      }
    }
  }
  if (!card.image || !existsSync(resolve(ROOT, card.image))) fail(`homeCards[${card.key}].image 不存在: ${card.image}`);
}

// --- contacts ---
// 前端仅保留无敏感值的骨架（真实值由 /api/site 按域名返回），允许 value/href 为空。
const contactKeys = contacts.map((item) => item.key);
if (new Set(contactKeys).size !== contactKeys.length) fail("contacts.key 不唯一");
for (const item of contacts) {
  if (!item.label || !item.key) fail(`contacts[${item.key}] label/key 缺失`);
  for (const secret of [item.value, item.href]) {
    if (typeof secret === "string" && (secret.includes("163.com") || secret.includes("t.me/") || secret.includes("steamcommunity"))) {
      fail(`contacts[${item.key}] 不应包含敏感直链（应由 /api/site 返回）`);
    }
  }
}

// --- cities ---
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES = new Set(["visited", "planned", "pending"]);
const slugs = cities.map((city) => city.slug);
if (new Set(slugs).size !== slugs.length) fail("cities.slug 不唯一（存在重复城市）");

const extraShapes = new Set(["wheel", "japan", "harbor", "plain", ...Object.values(visualShapes)]);
for (const city of cities) {
  const id = city.slug || "unknown";
  if (!DATE_RE.test(String(city.date || ""))) fail(`${id}: date 格式错误 "${city.date}"`);
  if (city.dateStatus && !VALID_STATUSES.has(city.dateStatus)) fail(`${id}: 非法 dateStatus "${city.dateStatus}"`);
  if (city.dateStatus !== "pending" && Number.isNaN(Date.parse(city.date))) fail(`${id}: date 无法解析 "${city.date}"`);

  for (const field of ["name", "region", "summary", "highlight"]) {
    for (const lang of LANGS) {
      if (!textOf(city[field], lang)) fail(`${id}: ${field}.${lang} 缺失`);
    }
  }
  if (!Array.isArray(city.tags) || city.tags.length < 3) fail(`${id}: tags 少于 3 个`);
  else {
    for (const tag of city.tags) {
      for (const lang of LANGS) {
        if (!textOf(tag, lang)) fail(`${id}: tag.${lang} 缺失`);
      }
    }
  }

  const visual = city.visual || {};
  if (!visual.shape || !extraShapes.has(visual.shape)) fail(`${id}: 非法 visual.shape "${visual.shape}"`);
  if (!String(visual.glyph || "").trim()) fail(`${id}: visual.glyph 缺失`);
  if (!visual.image || !existsSync(resolve(ROOT, visual.image))) fail(`${id}: visual.image 不存在: ${visual.image}`);
}

// --- japanPlan ---
const japan = japanPlan;
if (japan.slug !== "japan-2026") fail("japanPlan.slug 必须为 japan-2026");
if (!DATE_RE.test(japan.date) || !DATE_RE.test(japan.endDate)) fail("japanPlan date/endDate 格式错误");
if (Number.isNaN(Date.parse(japan.date)) || Number.isNaN(Date.parse(japan.endDate))) fail("japanPlan 日期无法解析");
for (const field of ["name", "region", "summary", "highlight"]) {
  for (const lang of LANGS) {
    if (!textOf(japan[field], lang)) fail(`japanPlan.${field}.${lang} 缺失`);
  }
}

if (!Array.isArray(japan.chapters) || japan.chapters.length !== 4) fail("japanPlan.chapters 必须是 4 个章节");
const chapterIds = new Set();
for (const chapter of japan.chapters || []) {
  if (!chapter.id) fail("japanPlan.chapters 存在无 id 的章节");
  if (chapterIds.has(chapter.id)) fail(`japanPlan.chapters id 重复: ${chapter.id}`);
  chapterIds.add(chapter.id);
  for (const field of ["title", "summary"]) {
    for (const lang of LANGS) {
      if (!textOf(chapter[field], lang)) fail(`japanPlan.chapters[${chapter.id}].${field}.${lang} 缺失`);
    }
  }
}

if (!Array.isArray(japan.posters) || japan.posters.length !== 15) fail(`japanPlan.posters 必须是 15 张海报，当前 ${japan.posters?.length}`);
japan.posters?.forEach((poster, index) => {
  const label = textOf(poster.label, "zh");
  const expected = String(index + 1).padStart(2, "0");
  if (!label.includes(expected)) fail(`japanPlan.posters[${index}].label 未包含连续编号 ${expected}（Day 01~15 不连续）`);
  if (!chapterIds.has(poster.chapter)) fail(`japanPlan.posters[${index}].chapter 无效: ${poster.chapter}`);
  if (!DATE_RE.test(String(poster.date || "")) || Number.isNaN(Date.parse(poster.date))) {
    fail(`japanPlan.posters[${index}].date 无效: ${poster.date}`);
  }
  for (const field of ["place", "label", "summary", "alt"]) {
    for (const lang of LANGS) {
      if (!textOf(poster[field], lang)) fail(`japanPlan.posters[${index}].${field}.${lang} 缺失`);
    }
  }
  if (!poster.image || !existsSync(resolve(ROOT, poster.image))) {
    fail(`japanPlan.posters[${index}].image 不存在: ${poster.image}`);
  }
});

// --- japanPlan.footprints（Google 时间轴解析出的每日足迹） ---
const pendingFootprintImages = [];
const footprints = japan.footprints;
if (!footprints || !Array.isArray(footprints.days) || footprints.days.length === 0) {
  fail("japanPlan.footprints.days 必须是数组且非空");
} else {
  for (const field of ["title", "note"]) {
    for (const lang of LANGS) {
      if (!textOf(footprints[field], lang)) fail(`japanPlan.footprints.${field}.${lang} 缺失`);
    }
  }
  const footprintDates = new Set();
  footprints.days.forEach((day, index) => {
    if (!DATE_RE.test(String(day.date || "")) || Number.isNaN(Date.parse(String(day.date)))) {
      fail(`japanPlan.footprints.days[${index}].date 无效: ${day.date}`);
    } else if (footprintDates.has(day.date)) {
      fail(`japanPlan.footprints.days 日期重复: ${day.date}`);
    } else {
      footprintDates.add(day.date);
    }
    for (const field of ["title", "summary"]) {
      for (const lang of LANGS) {
        if (!textOf(day[field], lang)) fail(`japanPlan.footprints.days[${index}].${field}.${lang} 缺失`);
      }
    }
    if (day.image) {
      if (!String(day.image).startsWith("assets/images/japan-2026/") || !day.image.endsWith(".png")) {
        fail(`japanPlan.footprints.days[${index}].image 必须是 assets/images/japan-2026/ 下的 PNG: ${day.image}`);
      }
      for (const lang of LANGS) {
        if (!textOf(day.imageAlt, lang)) fail(`japanPlan.footprints.days[${index}].imageAlt.${lang} 缺失`);
      }
      if (!existsSync(resolve(ROOT, day.image))) pendingFootprintImages.push(day.image);
    }
    if (!Array.isArray(day.stops) || day.stops.length === 0) {
      fail(`japanPlan.footprints.days[${index}].stops 缺失`);
    } else {
      day.stops.forEach((stop, stopIndex) => {
        if (!String(stop.time || "").trim()) fail(`japanPlan.footprints.days[${index}].stops[${stopIndex}].time 缺失`);
        for (const field of ["place", "note"]) {
          for (const lang of LANGS) {
            if (!textOf(stop[field], lang)) fail(`japanPlan.footprints.days[${index}].stops[${stopIndex}].${field}.${lang} 缺失`);
          }
        }
      });
    }
  });
}

// --- report ---
if (errors.length) {
  console.error(`check-data: ${errors.length} 个问题`);
  for (const error of errors) console.error(`  ❌ ${error}`);
  process.exit(1);
}
if (pendingFootprintImages.length) {
  console.log(`check-data: 待补足迹插画 ${pendingFootprintImages.length} 张（文件缺失时页面不渲染该图，补齐后自动出现）: ${pendingFootprintImages.join(", ")}`);
}
console.log(`check-data: OK（${languages.length} 语言、${homeCards.length} 卡片、${contacts.length} 联系方式、${cities.length} 城市、${japan.posters.length} 张日本海报、${japan.footprints ? japan.footprints.days.length : 0} 天足迹）`);
