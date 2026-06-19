import { cp, mkdir, rm } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const out = new URL("public/", root);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const entries = [
  "index.html",
  "admin.html",
  "travel",
  "cities",
  "en",
  "ja",
  "assets",
  "manifest.webmanifest",
  "sw.js",
  "_headers",
  "_redirects",
];

for (const entry of entries) {
  await cp(new URL(entry, root), new URL(entry, out), { recursive: true });
}
