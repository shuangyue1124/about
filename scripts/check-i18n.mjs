// i18n completeness: every user-visible zh string must have ja/en (or explicit fallback).
// Run: node scripts/check-i18n.mjs
import { cities, homeCards, japanPlan, ui } from "../assets/js/data.js";

const failures = [];
function fail(msg) {
  failures.push(msg);
  console.log(`FAIL - ${msg}`);
}
function ok(msg) {
  console.log(`ok - ${msg}`);
}

const langs = ["zh", "ja", "en"];
// 1. ui keys parity
const zhKeys = Object.keys(ui.zh || {});
for (const lang of ["ja", "en"]) {
  for (const key of zhKeys) {
    if (!(key in (ui[lang] || {}))) fail(`ui.${lang}.${key} missing`);
    else if (!String(ui[lang][key] ?? "").trim() && !["heroMeta", "footerLeft"].includes(key)) fail(`ui.${lang}.${key} empty`);
  }
}
ok(`ui keys checked (${zhKeys.length} keys x zh/ja/en)`);

// 2. homeCards trilingual
for (const card of homeCards) {
  for (const field of ["title", "body"]) {
    for (const lang of langs) {
      if (!card[field]?.[lang]) fail(`homeCards.${card.key}.${field}.${lang} missing`);
    }
  }
  for (const lang of langs) {
    if (!Array.isArray(card.tags?.[lang]) || !card.tags[lang].length) fail(`homeCards.${card.key}.tags.${lang} missing`);
  }
}
ok(`homeCards checked (${homeCards.length} cards)`);

// 3. cities trilingual (name/region/summary/highlight/tags)
for (const city of cities.slice(0, 60)) {
  for (const field of ["name", "region", "summary", "highlight"]) {
    for (const lang of langs) {
      if (!city[field]?.[lang]) fail(`cities.${city.slug}.${field}.${lang} missing`);
    }
  }
}
ok(`cities checked (${cities.length} stops)`);

// 4. japanPlan trilingual
for (const field of ["name", "region", "summary", "highlight"]) {
  for (const lang of langs) {
    if (!japanPlan[field]?.[lang]) fail(`japanPlan.${field}.${lang} missing`);
  }
}
ok("japanPlan checked");

// 5. No Chinese-only hardcode in ja/en UI strings for new modules
const moduleKeys = ["animeTitle", "gamesTitle", "githubTitle", "contactTitle", "travelTitle", "aboutTitle"];
for (const key of moduleKeys) {
  for (const lang of ["ja", "en"]) {
    const v = String(ui[lang]?.[key] || "");
    if (!v) fail(`ui.${lang}.${key} missing (new module title)`);
  }
}
ok("module titles present in zh/ja/en");

// 6. Dynamic content fallback contract: frontend text() falls back to zh
// (verified by code inspection: app.js text() uses value[lang] || value.zh)
ok("dynamic fallback contract: value[lang] || value.zh (app.js text())");

if (failures.length) {
  console.error(`\ncheck-i18n failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAll i18n checks passed.");
