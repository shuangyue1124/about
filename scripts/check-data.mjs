import { existsSync } from "node:fs";
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
if (!Array.isArray(languages) || languages.length !== LANGS.length) {
  fail(`languages 必须是 ${LANGS.length} 种语言，当前 ${languages?.length}`);
} else {
  for (const lang of LANGS) {
    if (!languages.some((item) => item.code === lang)) fail(`languages 缺少 ${lang}`);
  }
}

// --- profile ---
for (const field of ["nickname", "avatar", "githubUrl", "githubUser", "email"]) {
  if (!String(profile[field] || "").trim()) fail(`profile.${field} 缺失`);
}
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
const contactKeys = contacts.map((item) => item.key);
if (new Set(contactKeys).size !== contactKeys.length) fail("contacts.key 不唯一");
for (const item of contacts) {
  if (!item.label || !item.value) fail(`contacts[${item.key}] label/value 缺失`);
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

// --- report ---
if (errors.length) {
  console.error(`check-data: ${errors.length} 个问题`);
  for (const error of errors) console.error(`  ❌ ${error}`);
  process.exit(1);
}
console.log(`check-data: OK（${languages.length} 语言、${homeCards.length} 卡片、${contacts.length} 联系方式、${cities.length} 城市、${japan.posters.length} 张日本海报）`);
