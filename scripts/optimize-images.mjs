import { mkdir, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sourceDir = resolve(root, "assets/images");
const outputDir = resolve(sourceDir, "generated");
const widths = [480, 960];

async function collectPngs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (path.startsWith(outputDir)) continue;
    if (entry.isDirectory()) files.push(...await collectPngs(path));
    else if (extname(entry.name).toLowerCase() === ".png") files.push(path);
  }
  return files;
}

await mkdir(outputDir, { recursive: true });
const files = await collectPngs(sourceDir);

for (const file of files) {
  const rel = relative(sourceDir, file).replace(/\.png$/i, "");
  for (const width of widths) {
    const out = resolve(outputDir, `${rel}-${width}.webp`);
    await mkdir(dirname(out), { recursive: true });
    await sharp(file)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(out);
  }
}

console.log(`Generated ${files.length * widths.length} responsive WebP images in ${outputDir}`);
