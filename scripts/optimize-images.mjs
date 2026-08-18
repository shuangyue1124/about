import { mkdir, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sourceDir = resolve(root, "assets/images");
const outputDir = resolve(sourceDir, "generated");
const widths = [480, 960];
const avatarPath = resolve(sourceDir, "avatar.webp");
const heroPath = resolve(sourceDir, "home-hero-ink.png");

async function collectPngs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (path.startsWith(outputDir)) continue;
    if (entry.isDirectory()) files.push(...await collectPngs(path));
    else if (extname(entry.name).toLowerCase() === ".png" && !/^(favicon-32|icon-\d+)\.png$/i.test(entry.name)) files.push(path);
  }
  return files;
}

await mkdir(outputDir, { recursive: true });
const files = await collectPngs(sourceDir);

for (const file of files) {
  const rel = relative(sourceDir, file).replaceAll("\\", "/").replace(/\.png$/i, "");
  for (const width of widths) {
    const out = resolve(outputDir, `${rel}-${width}.webp`);
    await mkdir(dirname(out), { recursive: true });
    await sharp(file)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(out);
  }

  if (rel.startsWith("japan-2026/")) {
    const archiveOut = resolve(outputDir, `${rel}-1440.webp`);
    await mkdir(dirname(archiveOut), { recursive: true });
    await sharp(file)
      .resize({ width: 1440, withoutEnlargement: true })
      .webp({ quality: 84, effort: 5 })
      .toFile(archiveOut);
  }
}

await sharp(heroPath)
  .resize({ width: 1600, withoutEnlargement: true })
  .webp({ quality: 80, effort: 5 })
  .toFile(resolve(outputDir, "home-hero-ink-1600.webp"));

const avatar = await sharp(avatarPath)
  .resize(180, 180, { fit: "cover" })
  .composite([{
    input: Buffer.from('<svg width="180" height="180"><circle cx="90" cy="90" r="90" fill="white"/></svg>'),
    blend: "dest-in",
  }])
  .png()
  .toBuffer();

const cardOverlay = Buffer.from(`
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fcfaf8" stop-opacity="0.94"/>
        <stop offset="1" stop-color="#efe7db" stop-opacity="0.84"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="#fcfaf8" fill-opacity="0.28"/>
    <rect x="58" y="52" width="1084" height="526" rx="34" fill="url(#paper)" stroke="#26251e" stroke-opacity="0.16" stroke-width="2"/>
    <circle cx="185" cy="242" r="104" fill="#fffdf8" fill-opacity="0.88" stroke="#b95f37" stroke-opacity="0.42" stroke-width="3"/>
    <text x="320" y="184" fill="#b95f37" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="28" font-weight="700" letter-spacing="5">NFC 个人名片</text>
    <text x="316" y="286" fill="#26251e" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="78" font-weight="700">朔风霜月</text>
    <text x="320" y="354" fill="#504f49" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="30">在像素世界、旅途与代码里收集灵感。</text>
    <line x1="320" y1="404" x2="1030" y2="404" stroke="#35584a" stroke-opacity="0.36" stroke-width="2"/>
    <text x="320" y="468" fill="#35584a" font-family="SFSY Inter, Segoe UI, sans-serif" font-size="29" font-weight="600">about.shuangyue.space</text>
    <rect x="1018" y="450" width="62" height="62" rx="14" fill="none" stroke="#b95f37" stroke-opacity="0.68" stroke-width="3"/>
    <text x="1049" y="493" text-anchor="middle" fill="#b95f37" font-family="Microsoft YaHei, serif" font-size="31">霜</text>
  </svg>
`);

await sharp(heroPath)
  .resize(1200, 630, { fit: "cover" })
  .modulate({ brightness: 1.03, saturation: 0.72 })
  .composite([
    { input: cardOverlay, left: 0, top: 0 },
    { input: avatar, left: 95, top: 152 },
  ])
  .webp({ quality: 84, effort: 6 })
  .toFile(resolve(sourceDir, "og-card.webp"));

for (const size of [32, 192, 512]) {
  const name = size === 32 ? "favicon-32.png" : `icon-${size}.png`;
  await sharp(avatarPath)
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9, palette: size === 32 })
    .toFile(resolve(sourceDir, name));
}

const archiveImages = files.filter((file) => relative(sourceDir, file).replaceAll("\\", "/").startsWith("japan-2026/")).length;
console.log(`Generated ${files.length * widths.length + archiveImages} responsive WebP images, hero variants, icons, and og-card.webp`);
