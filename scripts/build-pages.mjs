import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cities, japanPlan } from "../assets/js/data.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, "cities");

function pageFor(stop) {
  const zhName = stop.name.zh;
  const description = stop.summary.zh;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${escapeAttr(description)}">
    <meta name="theme-color" content="#fcfaf8">
    <meta name="color-scheme" content="light">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${escapeAttr(zhName)} | 朔风霜月旅行足迹">
    <meta property="og:description" content="${escapeAttr(description)}">
    <title>${escapeHtml(zhName)} | 朔风霜月旅行足迹</title>
    <link rel="stylesheet" href="../assets/css/styles.css?v=20260612-skill-opt">
  </head>
  <body data-page="city" data-root=".." data-city="${escapeAttr(stop.slug)}">
    <div id="app"></div>
    <noscript>请启用 JavaScript 以查看城市水墨页。</noscript>
    <script type="module" src="../assets/js/app.js?v=20260612-skill-opt"></script>
  </body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

await mkdir(outDir, { recursive: true });
for (const stop of [japanPlan, ...cities]) {
  await writeFile(resolve(outDir, `${stop.slug}.html`), pageFor(stop), "utf8");
}

console.log(`Generated ${cities.length + 1} city pages in ${outDir}`);

