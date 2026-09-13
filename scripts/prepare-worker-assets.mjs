import { cp, mkdir, rm } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const out = new URL("public/", root);
const japanPosterSourceDir = fileURLToPath(new URL("assets/images/japan-2026/", root));
const nonPublishedImagePaths = new Set([
  fileURLToPath(new URL("assets/images/home-hero-ink.png", root)),
  fileURLToPath(new URL("assets/images/cities/japan-train-fuji-torii.png", root)),
]);

function excludeNonPublishedImages(source) {
  if (nonPublishedImagePaths.has(source)) return false;
  const pathFromPosterSources = relative(japanPosterSourceDir, source);
  const isPosterSource = pathFromPosterSources === ""
    || (pathFromPosterSources !== ".."
      && !pathFromPosterSources.startsWith(`..${sep}`)
      && !isAbsolute(pathFromPosterSources));
  return !isPosterSource;
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const entries = [
  "index.html",
  "admin.html",
  "manage.html",
  "travel",
  "cities",
  "en",
  "ja",
  "assets",
  "manifest.webmanifest",
  "contact.vcf",
  "robots.txt",
  "sitemap.xml",
  "sw.js",
  "_headers",
  "_redirects",
];

for (const entry of entries) {
  const options = entry === "assets"
    ? { recursive: true, filter: excludeNonPublishedImages }
    : { recursive: true };
  await cp(new URL(entry, root), new URL(entry, out), options);
}
