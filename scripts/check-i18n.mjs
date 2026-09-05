import { cities, homeCards, japanPlan, languages, ui } from "../assets/js/data.js";

const errors = [];
const fail = (message) => errors.push(message);
const LANGS = ["zh", "ja", "en"];

function textOf(value, lang) {
  return value && typeof value === "object" ? String(value[lang] || "").trim() : String(value || "").trim();
}

function checkTri(source, field, tri) {
  for (const lang of LANGS) {
    if (!textOf(tri, lang)) fail(`${source}: ${field}.${lang} missing`);
  }
}

// --- ui key parity across the three languages ---
const keys = Object.fromEntries(LANGS.map((lang) => [lang, Object.keys(ui[lang] || {})]));
for (const lang of LANGS) {
  if (keys[lang].length === 0) fail(`ui.${lang} 为空`);
}
const all = new Set(LANGS.flatMap((lang) => keys[lang]));
for (const key of all) {
  for (const lang of LANGS) {
    if (!keys[lang].includes(key)) fail(`ui.${lang} 缺少 key "${key}"`);
    else if (!String(ui[lang][key] || "").trim()) fail(`ui.${lang}["${key}"] 为空`);
  }
}

// --- languages metadata ---
for (const lang of LANGS) {
  const entry = languages.find((item) => item.code === lang);
  if (!entry?.label || !entry?.html) fail(`languages.${lang} 的 label/html 缺失`);
}

// --- cities tri-lingual completeness ---
for (const city of cities) {
  const id = city.slug;
  checkTri(`cities[${id}]`, "name", city.name);
  checkTri(`cities[${id}]`, "region", city.region);
  checkTri(`cities[${id}]`, "summary", city.summary);
  checkTri(`cities[${id}]`, "highlight", city.highlight);
  (city.tags || []).forEach((tag, index) => checkTri(`cities[${id}].tags[${index}]`, "tag", tag));
}

// --- homeCards tri-lingual completeness ---
for (const card of homeCards) {
  checkTri(`homeCards[${card.key}]`, "title", card.title);
  checkTri(`homeCards[${card.key}]`, "body", card.body);
  for (const lang of LANGS) {
    if (!Array.isArray(card.tags?.[lang]) || card.tags[lang].length === 0) {
      fail(`homeCards[${card.key}].tags.${lang} missing`);
    }
  }
}

// --- japanPlan 15-day journey tri-lingual completeness ---
checkTri("japanPlan", "name", japanPlan.name);
checkTri("japanPlan", "region", japanPlan.region);
checkTri("japanPlan", "summary", japanPlan.summary);
checkTri("japanPlan", "highlight", japanPlan.highlight);
japanPlan.chapters.forEach((chapter, index) => {
  checkTri(`japanPlan.chapters[${index}]`, "title", chapter.title);
  checkTri(`japanPlan.chapters[${index}]`, "summary", chapter.summary);
});
japanPlan.posters.forEach((poster, index) => {
  const number = index + 1; // user-facing numbering, matching the report example "japanPlan[7]"
  checkTri(`japanPlan[${number}]`, "place", poster.place);
  checkTri(`japanPlan[${number}]`, "label", poster.label);
  checkTri(`japanPlan[${number}]`, "summary", poster.summary);
  checkTri(`japanPlan[${number}]`, "alt", poster.alt);
});

// --- report ---
if (errors.length) {
  console.error(`check-i18n: ${errors.length} 个问题`);
  for (const error of errors) console.error(`  ❌ ${error}`);
  process.exit(1);
}
const uiKeys = keys.zh.length;
console.log(`check-i18n: OK（ui 三语 ${uiKeys} 个 key 一致、${cities.length} 城市与 ${japanPlan.posters.length} 张日本海报三语完整）`);
