import { access, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cities, homeCards, japanPlan, ui } from "../assets/js/data.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetVersion = "20260614-varied-images";
const origin = readArg("--origin");

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
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}verify=${Date.now()}`);
  if (!response.ok) {
    fail(`${url} returned ${response.status}`);
    return;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith(contentTypePrefix)) {
    fail(`${url} returned content-type ${contentType}`);
  }
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
  for (const image of stopImages) {
    imageCounts.set(image, (imageCounts.get(image) || 0) + 1);
    if (!image.startsWith("assets/images/cities/")) {
      fail(`${image} must use a city-specific asset, not a regional fallback`);
    }
    await assertFile(toLocalPath(image));
    await assertFile(toLocalPath(image, "public"));
  }

  const overused = [...imageCounts.entries()].filter(([, count]) => count > 3);
  if (overused.length) {
    fail(`city image reuse exceeds 3 stops: ${overused.map(([image, count]) => `${image}=${count}`).join(", ")}`);
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

  await access(resolve(root, "wrangler.jsonc"));

  if (origin) {
    const normalizedOrigin = origin.replace(/\/$/, "");
    const homeResponse = await fetch(`${normalizedOrigin}/?verify=${Date.now()}`);
    if (!homeResponse.ok) {
      fail(`${normalizedOrigin}/ returned ${homeResponse.status}`);
    } else {
      const html = await homeResponse.text();
      if (!html.includes(assetVersion)) {
        fail(`${normalizedOrigin}/ does not reference ${assetVersion}`);
      }
    }

    await assertRemoteAsset(`${normalizedOrigin}/assets/images/home/about.png`, "image/");
    await assertRemoteAsset(`${normalizedOrigin}/assets/images/cities/zhangjiajie-pillars.png`, "image/");
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
