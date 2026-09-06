import { readFileSync } from "node:fs";
import { cities, homeCards, japanPlan, languages, ui } from "../assets/js/data.js";

const errors = [];
const fail = (message) => errors.push(message);
const LANGS = ["zh", "ja", "en"];

// app.js runs in the browser (document/window), so it cannot be imported here.
// Read it as text and evaluate only the two localization object literals;
// nothing is copied into this file, keeping app.js as the single source.
function extractObjectLiteral(source, constName) {
  const marker = `const ${constName} =`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) throw new Error(`${constName} not found in app.js`);
  const braceStart = source.indexOf("{", markerIndex);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`${constName} object literal not closed in app.js`);
}

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

// --- app.js localized objects (commentUi, nowStatusNotes) ---
let commentUi = null;
let nowStatusNotes = null;
try {
  const appSource = readFileSync(new URL("../assets/js/app.js", import.meta.url), "utf8");
  commentUi = new Function(`return (${extractObjectLiteral(appSource, "commentUi")});`)();
  nowStatusNotes = new Function(`return (${extractObjectLiteral(appSource, "nowStatusNotes")});`)();
} catch (error) {
  fail(`app.js 本地化对象解析失败: ${error?.message || error}`);
}
if (commentUi) {
  const commentKeys = Object.fromEntries(LANGS.map((lang) => [lang, Object.keys(commentUi[lang] || {})]));
  for (const lang of LANGS) {
    if (commentKeys[lang].length === 0) fail(`commentUi.${lang} 为空`);
  }
  const allCommentKeys = new Set(LANGS.flatMap((lang) => commentKeys[lang]));
  for (const key of allCommentKeys) {
    for (const lang of LANGS) {
      if (!commentKeys[lang].includes(key)) fail(`commentUi.${lang} 缺少 key "${key}"`);
      else if (typeof commentUi[lang][key] !== "string" || !commentUi[lang][key].trim()) fail(`commentUi.${lang}["${key}"] 为空`);
    }
  }
}
if (nowStatusNotes) {
  const noteKeys = Object.keys(nowStatusNotes);
  if (noteKeys.length === 0) fail("nowStatusNotes 为空");
  for (const noteKey of noteKeys) {
    checkTri("nowStatusNotes", noteKey, nowStatusNotes[noteKey]);
  }
}

// --- report ---
if (errors.length) {
  console.error(`check-i18n: ${errors.length} 个问题`);
  for (const error of errors) console.error(`  ❌ ${error}`);
  process.exit(1);
}
const uiKeys = keys.zh.length;
const commentKeysCount = commentUi ? Object.keys(commentUi.zh || {}).length : 0;
const noteCount = nowStatusNotes ? Object.keys(nowStatusNotes).length : 0;
console.log(`check-i18n: OK（ui 三语 ${uiKeys} 个 key 一致、${cities.length} 城市与 ${japanPlan.posters.length} 张日本海报三语完整、commentUi ${commentKeysCount} 个 key 与 nowStatusNotes ${noteCount} 组三语完整）`);
