import { access, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { cities, homeCards, japanPlan, ui } from "../assets/js/data.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetVersion = "20260818-japan-travel";
const origin = readArg("--origin");
const remoteTimeoutMs = 30000;

const failures = [];
const checkedFiles = new Set();

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function fail(message) {
  failures.push(message);
}

function toLocalPath(assetPath, prefix = "") {
  return resolve(root, prefix, ...assetPath.split("/"));
}

async function assertFile(path) {
  if (checkedFiles.has(path)) return;
  checkedFiles.add(path);
  try {
    const info = await stat(path);
    if (!info.isFile()) fail(`${path} is not a file`);
    if (info.size <= 0) fail(`${path} is empty`);
  } catch {
    fail(`${path} is missing`);
  }
}

async function assertContains(path, expected) {
  try {
    const content = await readFile(path, "utf8");
    if (!content.includes(expected)) fail(`${path} does not contain ${expected}`);
  } catch {
    fail(`${path} could not be read`);
  }
}

async function assertRemoteAsset(url, contentTypePrefix) {
  const response = await fetchWithRetry(`${url}${url.includes("?") ? "&" : "?"}verify=${Date.now()}`);
  if (!response) return;
  if (!response.ok) {
    fail(`${url} returned ${response.status}`);
    return;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith(contentTypePrefix)) {
    fail(`${url} returned content-type ${contentType}`);
  }
}

async function fetchWithRetry(url, attempts = 2) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(remoteTimeoutMs) });
    } catch (error) {
      lastError = error;
    }
  }

  fail(`${url} could not be fetched: ${lastError?.message || "unknown error"}`);
  return null;
}

async function main() {
  const homeImages = homeCards.map((card) => card.image);
  if (new Set(homeImages).size !== homeImages.length) {
    fail("home card images must be unique");
  }

  for (const image of homeImages) {
    if (!image.startsWith("assets/images/home/")) {
      fail(`${image} must live under assets/images/home/`);
    }
    await assertFile(toLocalPath(image));
    await assertFile(toLocalPath(image, "public"));
  }

  const stops = [...cities, japanPlan];
  const stopImages = stops.map((stop) => stop.visual?.image).filter(Boolean);
  const missingImages = stops.filter((stop) => !stop.visual?.image).map((stop) => stop.slug);
  if (missingImages.length) {
    fail(`stops missing visual.image: ${missingImages.join(", ")}`);
  }

  const imageCounts = new Map();
  for (const stop of stops) {
    const image = stop.visual.image;
    imageCounts.set(image, (imageCounts.get(image) || 0) + 1);
    const expectedPrefix = stop.slug === japanPlan.slug
      ? "assets/images/japan-2026/"
      : "assets/images/cities/";
    if (!image.startsWith(expectedPrefix)) {
      fail(`${image} must use the dedicated ${stop.slug} image collection`);
    }
    await assertFile(toLocalPath(image));
    await assertFile(toLocalPath(image, "public"));
  }

  const overused = [...imageCounts.entries()].filter(([, count]) => count > 3);
  if (overused.length) {
    fail(`city image reuse exceeds 3 stops: ${overused.map(([image, count]) => `${image}=${count}`).join(", ")}`);
  }

  const tripPosters = Array.isArray(japanPlan.posters) ? japanPlan.posters : [];
  if (tripPosters.length !== 15) {
    fail(`japanPlan.posters must contain 15 entries, got ${tripPosters.length}`);
  }
  if (!Array.isArray(japanPlan.chapters) || japanPlan.chapters.length !== 4) {
    fail(`japanPlan.chapters must contain 4 entries, got ${japanPlan.chapters?.length || 0}`);
  }

  const posterDates = new Set();
  const posterImages = new Set();
  const chapterIds = new Set((japanPlan.chapters || []).map((chapter) => chapter.id));
  for (const [index, poster] of tripPosters.entries()) {
    const expectedNumber = String(index + 1).padStart(2, "0");
    if (!poster.image?.startsWith(`assets/images/japan-2026/${expectedNumber}-`) || !poster.image.endsWith(".png")) {
      fail(`japan poster ${index + 1} must use numbered assets/images/japan-2026 PNG path`);
      continue;
    }
    if (posterDates.has(poster.date)) fail(`duplicate japan poster date: ${poster.date}`);
    if (posterImages.has(poster.image)) fail(`duplicate japan poster image: ${poster.image}`);
    posterDates.add(poster.date);
    posterImages.add(poster.image);
    if (!chapterIds.has(poster.chapter)) fail(`japan poster ${poster.image} references unknown chapter ${poster.chapter}`);
    for (const field of ["place", "label", "summary", "alt"]) {
      for (const lang of ["zh", "ja", "en"]) {
        if (!poster[field]?.[lang]) fail(`japan poster ${poster.image} is missing ${field}.${lang}`);
      }
    }

    const sourcePath = toLocalPath(poster.image);
    await assertFile(sourcePath);
    await assertFile(toLocalPath(poster.image, "public"));
    const metadata = await sharp(sourcePath).metadata();
    if (metadata.width !== 1440 || metadata.height !== 1800 || metadata.format !== "png") {
      fail(`${poster.image} must be a 1440x1800 PNG, got ${metadata.width}x${metadata.height} ${metadata.format}`);
    }
    const generatedBase = poster.image.replace("assets/images/", "assets/images/generated/").replace(/\.png$/, "");
    for (const width of [480, 960, 1440]) {
      const generatedPath = toLocalPath(`${generatedBase}-${width}.webp`);
      const publicGeneratedPath = toLocalPath(`${generatedBase}-${width}.webp`, "public");
      await assertFile(generatedPath);
      await assertFile(publicGeneratedPath);
      try {
        const generated = await sharp(generatedPath).metadata();
        if (generated.width !== width || generated.height !== Math.round(width * 1.25) || generated.format !== "webp") {
          fail(`${generatedBase}-${width}.webp must preserve 4:5 WebP dimensions`);
        }
      } catch {
        // assertFile above records missing outputs.
      }
    }
  }

  for (const page of ["cities/japan-2026.html", "en/cities/japan-2026.html", "ja/cities/japan-2026.html"]) {
    await assertContains(resolve(root, page), 'class="poster-card"');
    await assertContains(resolve(root, page), "2026-06-30");
    await assertContains(resolve(root, page), "2026-07-14");
    await assertContains(resolve(root, "public", page), 'class="poster-card"');
    try {
      const content = await readFile(resolve(root, page), "utf8");
      const posterCards = content.match(/class="poster-card"/g)?.length || 0;
      if (posterCards !== 15) fail(`${page} must render 15 poster cards, got ${posterCards}`);
      if (/E:\\env|日本旅游_照片整理/.test(content)) fail(`${page} must not expose local source paths`);
    } catch {
      fail(`${page} could not be read for poster count verification`);
    }
  }

  for (const [lang, labels] of Object.entries(ui)) {
    if (!labels.homeMotto) {
      fail(`ui.${lang}.homeMotto is missing`);
    }
  }

  await assertContains(resolve(root, "index.html"), assetVersion);
  await assertContains(resolve(root, "travel/index.html"), assetVersion);
  await assertContains(resolve(root, "admin.html"), assetVersion);
  await assertContains(resolve(root, "public/index.html"), assetVersion);
  await assertContains(resolve(root, "public/travel/index.html"), assetVersion);
  await assertContains(resolve(root, "public/admin.html"), assetVersion);
  await assertContains(resolve(root, "scripts/build-pages.mjs"), assetVersion);
  await assertContains(resolve(root, "index.html"), "朔风霜月");
  await assertContains(resolve(root, "index.html"), "https://about.shuangyue.space/assets/images/og-card.webp");
  await assertContains(resolve(root, "index.html"), "/contact.vcf");
  await assertContains(resolve(root, "contact.vcf"), "URL:https://about.shuangyue.space/");
  await assertContains(resolve(root, "public/contact.vcf"), "FN:朔风霜月");
  await assertFile(resolve(root, "public/robots.txt"));
  await assertFile(resolve(root, "public/sitemap.xml"));
  await assertContains(resolve(root, "public/robots.txt"), "Sitemap: https://about.shuangyue.space/sitemap.xml");
  await assertContains(resolve(root, "public/sitemap.xml"), "<loc>https://about.shuangyue.space/</loc>");

  const ogCard = await sharp(resolve(root, "assets/images/og-card.webp")).metadata();
  if (ogCard.width !== 1200 || ogCard.height !== 630 || ogCard.format !== "webp") {
    fail(`og-card.webp must be a 1200x630 WebP, got ${ogCard.width}x${ogCard.height} ${ogCard.format}`);
  }

  await access(resolve(root, "wrangler.jsonc"));

  if (origin) {
    const normalizedOrigin = origin.replace(/\/$/, "");
    const homeResponse = await fetchWithRetry(`${normalizedOrigin}/?verify=${Date.now()}`);
    if (!homeResponse) {
      // fetchWithRetry records the failure.
    } else if (!homeResponse.ok) {
      fail(`${normalizedOrigin}/ returned ${homeResponse.status}`);
    } else {
      const html = await homeResponse.text();
      if (!html.includes(assetVersion)) {
        fail(`${normalizedOrigin}/ does not reference ${assetVersion}`);
      }
    }

    await assertRemoteAsset(`${normalizedOrigin}/assets/images/home/about.png`, "image/");
    await assertRemoteAsset(`${normalizedOrigin}/assets/images/cities/zhangjiajie-pillars.png`, "image/");
    await assertRemoteAsset(`${normalizedOrigin}/assets/images/avatar.webp`, "image/webp");
    await assertRemoteAsset(`${normalizedOrigin}/assets/images/og-card.webp`, "image/webp");
    await assertRemoteAsset(`${normalizedOrigin}/assets/images/generated/japan-2026/01-arrival-480.webp`, "image/webp");
    await assertRemoteAsset(`${normalizedOrigin}/assets/images/generated/japan-2026/15-last-view-1440.webp`, "image/webp");
    await assertRemoteAsset(`${normalizedOrigin}/contact.vcf`, "text/vcard");

    const remoteTripPages = [
      ["/cities/japan-2026.html", "zh-CN"],
      ["/ja/cities/japan-2026.html", "ja-JP"],
      ["/en/cities/japan-2026.html", "en-US"],
    ];
    for (const [path, htmlLang] of remoteTripPages) {
      const tripResponse = await fetchWithRetry(`${normalizedOrigin}${path}?verify=${Date.now()}`);
      if (!tripResponse) continue;
      if (!tripResponse.ok) {
        fail(`${normalizedOrigin}${path} returned ${tripResponse.status}`);
        continue;
      }

      const tripHtml = await tripResponse.text();
      const posterCount = (tripHtml.match(/class="poster-card"/g) || []).length;
      if (!tripHtml.includes(assetVersion)) fail(`${normalizedOrigin}${path} does not reference ${assetVersion}`);
      if (!tripHtml.includes(`<html lang="${htmlLang}"`)) fail(`${normalizedOrigin}${path} does not use lang=${htmlLang}`);
      if (!tripHtml.includes('"@type":"CollectionPage"')) fail(`${normalizedOrigin}${path} does not expose CollectionPage JSON-LD`);
      if (posterCount !== 15) fail(`${normalizedOrigin}${path} contains ${posterCount} poster cards instead of 15`);
    }

    const robotsResponse = await fetchWithRetry(`${normalizedOrigin}/robots.txt`);
    if (!robotsResponse) {
      // fetchWithRetry records the failure.
    } else if (!robotsResponse.ok) {
      fail(`${normalizedOrigin}/robots.txt returned ${robotsResponse.status}`);
    } else {
      const robots = await robotsResponse.text();
      if (!robots.includes("Sitemap: https://about.shuangyue.space/sitemap.xml")) {
        fail(`${normalizedOrigin}/robots.txt does not reference the sitemap`);
      }
    }
  }

  if (failures.length) {
    console.error(`Image asset verification failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        assetVersion,
        homeImages: homeImages.length,
        cityStops: stops.length,
        cityImages: imageCounts.size,
        maxCityImageReuse: Math.max(...imageCounts.values()),
        origin: origin || null,
      },
      null,
      2,
    ),
  );
}

await main();
