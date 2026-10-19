// 把打包进站点的头像（assets/images/avatar.webp）刷新成 QQ 当前头像。
//
// 线上页面优先走 /api/avatar 的同源代理，所以换 QQ 头像后无需重新部署；
// 这个脚本只是让「弱网 / 代理失败时回退的本地头像」也保持同步，同时让
// 由 avatar.webp 生成的 favicon、PWA 图标和 og-card 一起更新。
//
// 用法：npm run sync:avatar        （QQ 号从 worker.js 的 DEFAULT_CONTACTS 读取）
//       npm run sync:avatar -- 123456789
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const target = resolve(root, "assets/images/avatar.webp");

const workerSource = readFileSync(resolve(root, "worker.js"), "utf8");
const fromWorker = workerSource.match(/type:\s*"qq"[^}]*?value:\s*"(\d{5,12})"/)?.[1] || "";
const uin = String(process.env.QQ_UIN || process.argv[2] || fromWorker).replace(/\D/g, "");
if (!/^\d{5,12}$/.test(uin)) {
  console.error("sync-avatar: 找不到 QQ 号，请传入参数或设置 QQ_UIN");
  process.exit(1);
}

const response = await fetch(`https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=640`, {
  headers: { accept: "image/*", "user-agent": "Mozilla/5.0 (compatible; shuangyue-about/1.0)" },
});
const contentType = String(response.headers.get("content-type") || "");
if (!response.ok || !contentType.startsWith("image/")) {
  console.error(`sync-avatar: QQ 头像拉取失败（${response.status} ${contentType}）`);
  process.exit(1);
}

const input = Buffer.from(await response.arrayBuffer());
if (!input.byteLength) {
  console.error("sync-avatar: QQ 头像返回空内容");
  process.exit(1);
}

await sharp(input)
  .resize(640, 640, { fit: "cover" })
  .webp({ quality: 88, effort: 5 })
  .toFile(target);

console.log(`sync-avatar: 已更新 ${target}（QQ ${uin}，${input.byteLength} 字节源图）`);
