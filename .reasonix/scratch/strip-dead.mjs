import { readFileSync, writeFileSync } from "node:fs";

const file = "assets/js/app.js";
const src = readFileSync(file, "utf8");

const dead = new Set([
  "text", "siteUrl", "pageLink", "pagePathFor", "contactDescription",
  "imageSrcset", "imageAlt", "provinceGlyph", "fmtDate", "monthLabel",
  "stopDate", "stopMonthLabel", "render", "layout", "renderHome", "terminal",
  "homeCard", "contactItem", "renderTravel", "groupByMonth", "cityPreview",
  "renderCity", "renderCityVisual", "cityFacts", "cityStoryItems",
  "storyLine", "pagerLink",
]);

// Locate every top-level function definition start (async function or function).
const defStarts = [];
const defRe = /^(?:async\s+)?function\s+(\w+)/gm;
let m;
while ((m = defRe.exec(src))) defStarts.push({ name: m[1], start: m.index, line: src.slice(0, m.index).split("\n").length });

const removals = [];
for (let i = 0; i < defStarts.length; i += 1) {
  const current = defStarts[i];
  if (!dead.has(current.name)) continue;
  const end = i + 1 < defStarts.length ? defStarts[i + 1].start : src.length;
  removals.push({ name: current.name, start: current.start, end });
}

let out = src;
for (const r of removals.sort((a, b) => b.start - a.start)) {
  out = out.slice(0, r.start) + out.slice(r.end);
}

// Drop now-unused data.js imports: only languages (commentTime) and ui (label) remain.
out = out.replace(
  'import { cities, contacts, homeCards, japanPlan, languages, profile, ui } from "./data.js";',
  'import { languages, ui } from "./data.js";'
);

// Drop now-unused top-level bindings.
out = out.replace(/^const app = document\.getElementById\("app"\);\r?\n/m, "");
out = out.replace(/^const currentCitySlug = document\.body\.dataset\.city \|\| citySlugFromPath\(\);\r?\n/m, "");

// Report leftover references to anything removed (other than in the removal comment).
const leftovers = [];
for (const name of dead) {
  if (new RegExp(`\\b${name}\\b`).test(out)) leftovers.push(name);
}
for (const ident of ["profile", "cities", "contacts", "homeCards", "japanPlan", "app", "currentCitySlug"]) {
  if (new RegExp(`\\b${ident}\\b`).test(out)) leftovers.push(`import/var:${ident}`);
}

console.log(`removed ${removals.length} functions:`, removals.map((r) => r.name).join(", "));
console.log(`leftover references: ${leftovers.length ? leftovers.join(", ") : "none"}`);
console.log(`size ${src.length} -> ${out.length} bytes`);

writeFileSync(file, out);
