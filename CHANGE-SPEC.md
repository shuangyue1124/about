# shuangyue-about 修改说明文档（自包含）

生成时间：2026-09-19
基线提交：`74431f2` feat(admin): new profile clones main-site config, travel city list visibility, required-field validation
适用范围：`D:\project\shuangyue-about`

> 本文档不依赖任何历史上下文，可直接粘贴到新对话执行。所有行号均基于当前工作区状态。

---

## 0. 项目背景（新对话读这一段即可上手）

### 0.1 项目是什么

`about.shuangyue.space` —— 一个多语言（中/日/英）个人 NFC 名片站。访客用手机碰 NFC 打开，可看个人资料、社交入口、联系方式、旅行足迹，并留言。

核心页面：首页、旅行页、44 个城市页、日本 2026 旅记专题页、管理员后台。

### 0.2 技术栈与部署

```text
GitHub main ──▶ Cloudflare Pages Git 集成 ──▶ npm run build ──▶ public/ ──▶ 线上
                        │
                        └── functions/api/**/*.js（Pages Functions，文件路由）
                                    │
                                    └── worker.js（2495 行单体，导出 9 个 handler）
                                              ├── D1（主库：comments / site_config / site_profiles / content_items / contact_items / site_events）
                                              ├── KV（仅公开评论缓存 + 限流计数）
                                              ├── Workers AI（评论审核 + 后台 AI 对话）
                                              └── Turnstile（留言人机校验）
```

- 构建：`npm run build` = `optimize:images` → `build:pages` → `prepare-worker-assets`（删除并重建 `public/`）
- 校验：`npm run check`（语法 + 图片 + data + i18n + schedule + links + seo + profiles）
- 关键：**Pages 下 `wrangler.jsonc` 被完全忽略**，`worker.js` 的 `export default { fetch }` 路由器在生产**不执行**，只有 `functions/` 下的文件路由生效。

### 0.3 目录职责

| 路径 | 作用 | 能否手改 |
|---|---|---|
| `assets/js/data.js` | 全站唯一数据源（1452 行 / 100KB），构建期与运行期共用 | 可以，改完必须重新构建 |
| `assets/js/app.js` / `admin.js` / `schedule.js` / `site-profile.js` | 浏览器端脚本 | 可以 |
| `scripts/build-pages.mjs` | 页面生成器，把 data.js 渲染成三语 HTML | 可以 |
| `scripts/check-*.mjs` | 6 个校验脚本 | 可以 |
| `worker.js` | 全部 API 逻辑 | 可以 |
| `functions/api/**/*.js` | 18 个约 140 字节的转发薄壳 | 可以，**新增端点必须加文件** |
| `index.html` / `cities/` / `en/` / `ja/` / `travel/` | **构建产物**，由 build-pages 写回 | ❌ 不要手改 |
| `public/` | **构建输出目录** | ❌ 不要手改，也建议加入 .gitignore |

### 0.4 硬约束（来自 AGENTS.md / 用户优化报告，违反即返工）

- 不要引入 React/Vue/Next.js，不要改成 SPA，不要迁移离开 Cloudflare Pages
- 不要运行 `npx wrangler deploy`，不要给 `about.shuangyue.space/*` 加 Worker route
- 不要直接修改 `public/` 和生成的 HTML
- 不要把管理员密码、Turnstile secret 写入仓库
- 上游真实旅行照片不得混进日本专题；只用 `assets/images/japan-2026/` 下的生成海报
- **PNG 源图不会上线**，必须经 `npm run build` 生成 WebP 衍生

---

## 1. 当前状态快照

### 1.1 已跟踪文件的改动（未提交，来自 2026-09-13 会话）

```text
17 files changed, 925 insertions(+), 103 deletions(-)

 assets/css/styles.css               | 173 ++++   （足迹区块样式）
 assets/js/data.js                   | 121 ++--   （新增 japanPlan.footprints）
 cities/japan-2026.html              |  47 ++--
 docs/README.md                      |   5 +-
 docs/architecture/asset-delivery.md |  20 ++-
 docs/features/visual-content.md     |  12 ++
 en/cities/japan-2026.html           |  47 ++--
 ja/cities/japan-2026.html           |  47 ++--
 public/**（同上 5 个文件的 public 副本）| 同步
 scripts/build-pages.mjs             |  31 +++
 scripts/check-data.mjs              |  54 +++-
 scripts/check-i18n.mjs              |  15 +++
 scripts/verify-image-assets.mjs     |  21 +++
```

### 1.2 未跟踪文件

```text
?? ARCHITECTURE-REVIEW.md   （本轮新增：全站架构评审）
?? TIMELINE-AUDIT.md        （本轮新增：时间轴路线核对）
?? HISTORY-DIGEST.md        （本轮新增：历史对话考古索引）
?? .workbuddy/              （本地记忆目录）
```

### 1.3 关键事实：本轮对话**没有修改任何源码**

2026-09-19 这一轮做的全部是**只读分析 + 产出文档**：

| 文件 | 性质 |
|---|---|
| `ARCHITECTURE-REVIEW.md` | 新增，全站架构评审（P0/P1/P2 问题清单 + 重构路线） |
| `TIMELINE-AUDIT.md` | 新增，Google 时间轴与 `footprints` 逐站核对 |
| `HISTORY-DIGEST.md` | 新增，reasonix/codex 历史对话索引 |
| `.workbuddy/memory/2026-09-19.md` | 新增，本地工作记忆 |

**工作区里那 17 个已修改文件是 2026-09-13 那轮 reasonix 会话的产物，不是本轮产生的，且至今未提交。**

---

## 2. 已完成的修改（按模块）

### 2.1 模块 A：新增交付文档（本轮，已完成）

| 文件 | 动机 | 内容 |
|---|---|---|
| `ARCHITECTURE-REVIEW.md` | 全站缺乏系统性的架构审视 | 4 项 P0 + 6 项 P1 + 安全/运维 P2；分 4 阶段的重构路线 |
| `TIMELINE-AUDIT.md` | `footprints` 数据准确性存疑 | 1712 个 GPS 点逐站核对；19 站中 11 站吻合，4 处待改 |
| `HISTORY-DIGEST.md` | 历史对话散落、难以追溯 | 对话存储位置、20 个相关会话清单、3 份源头资产、未完成事项 |

影响范围：纯文档，**不影响构建、不影响线上**。
注意：这 3 个文件是评审产物，确认后可删除或移入 `docs/`。

### 2.2 模块 B：每日真实足迹功能（09-13 会话，已完成但未提交）

这是工作区里那 17 个改动的主体——给日本旅记专题页加「每日真实足迹」区块。

**B-1 数据源 `assets/js/data.js`**

- 位置：`japanPlan.footprints`，第 1056–1136 行
- 改动：新增 `footprints` 字段，含 `title` / `note` / `days[3]`，每天有 `date` / `title` / `summary` / `image` / `imageAlt` / `stops[]`，全部中/日/英三语
- 影响：构建期（`build-pages.mjs:5`）与运行期共用此对象；`data.js` 含模块加载期副作用（`cities.push` 1274 行、`cities.forEach(enrichStop)` 1435 行、`Object.assign(japanPlan, …)` 1437 行），**改动时不要在顶层做额外 mutate**

**B-2 页面生成 `scripts/build-pages.mjs`**

- 位置：第 1 行加 `import { existsSync } from "node:fs"`；第 445 行在 `japanTripPage` 中插入 `${tripFootprints(locale, depth, trip)}`；新增函数 `tripFootprints()`（约第 492–523 行）
- 行为：`footprints.days` 为空数组则整块不渲染；`image` 文件不存在则只输出文字不输出 `<figure>`
- 影响：三语专题页；`public/` 同步重建

**B-3 样式 `assets/css/styles.css`**

- 位置：文件末尾新增约 173 行
- 新增选择器：`.trip-footprints`、`.trip-footprints__header/__note/__days`、`.footprint-day`、`.footprint-day--with-image`、`.footprint-day__figure/__date/__title/__summary/__stops`、`.footprint-stop`、`.footprint-stop__time/__text`，以及变量 `--trip-poster-paper`、`--trip-poster-line`
- 影响：仅日本专题页

**B-4 校验脚本**

| 脚本 | 位置 | 新增校验 |
|---|---|---|
| `check-data.mjs` | 第 146–204 行 | `footprints.days` 非空；`title`/`note` 三语；每天 `date` 合法且去重；`title`/`summary` 三语；`image` 必须是 `assets/images/japan-2026/` 下的 PNG；`imageAlt` 三语；插画缺失只提示不失败 |
| `check-i18n.mjs` | 第 103–118 行 | `footprints.title/note`、每天 `title/summary/imageAlt`、每个 stop `place/note` 三语齐全 |
| `verify-image-assets.mjs` | 第 188–206 行 | 插画文件出现后自动纳入 1440×1800 PNG 与 480/960/1440 WebP 产物校验 |

**B-5 文档 `docs/`**

- `docs/architecture/asset-delivery.md`：新增「每日足迹来自时间轴解析，插画缺失时不发布空图」章节；同步更新行号引用
- `docs/features/visual-content.md`：新增「日本旅记每日真实足迹」「足迹插画待补流程」两节
- `docs/README.md`：索引同步

### 2.3 当前校验状态

```
node scripts/check-data.mjs   → OK（3 语言、5 卡片、6 联系方式、44 城市、15 张海报、3 天足迹）
                                 附：待补足迹插画 3 张（不阻断）
node scripts/check-i18n.mjs   → OK（ui 85 key、44 城市、15 海报、commentUi 21 key、nowStatus 4 组）
node scripts/check-seo.mjs    → OK（150 个页面）
node scripts/check-links.mjs  → OK（2985 个本地引用）
```

三语页面均已渲染足迹区块，`public/` 与根目录版本同步。

---

## 3. 待执行的修改（完整规格）

### 3.1 【必须】`footprints` 4 处时间与地点修正

依据：`D:\Takeout\时间轴\Timeline Edits.json`（5385 条记录、1712 个有效坐标点，JST 2026-07-11 18:28:43 → 2026-07-13 16:43:20）。

| # | 行号 | 问题 | GPS 实测 |
|---|---|---|---|
| M1 | 1079 | `18:15` 枚方 | 首个点位 **18:28:43** = 34.79810,135.63044 |
| M2 | 1103 | `13:30` 近铁·生驹 | 生驹站在 **13:14–13:15** = 34.69318,135.69660；13:30 时已在奈良市内（距生驹 10.4 km） |
| M3 | 1108 | `17:30` 东大阪·下小阪 | 17:30 实测 34.66235,135.62910，**速度 26.4 m/s（≈94 km/h，仍在电车上）**，距下小阪 3–4.5 km；数据 17:32:20 中断，**GPS 从未到过下小阪** |
| M4 | 1130 | `11:45` 羽田机场 | 11:00:25 仍在神户机场；**11:00→11:56 无定位**；首个羽田点位 **11:56:46** = 35.54759,139.77080 |

**M1 —— `assets/js/data.js:1079`**

```diff
-          { time: "18:15", place: c("枚方 · 京阪沿线", "枚方 · 京阪沿線", "Hirakata · Keihan Line"), note: c("傍晚的列车沿京阪线南下。", "夕方の列車で京阪線を南下。", "An evening train runs south along the Keihan line.") },
+          { time: "18:28", place: c("枚方 · 京阪沿线", "枚方 · 京阪沿線", "Hirakata · Keihan Line"), note: c("傍晚的列车沿京阪线南下。", "夕方の列車で京阪線を南下。", "An evening train runs south along the Keihan line.") },
```

**M2 —— `assets/js/data.js:1103`**

```diff
-          { time: "13:30", place: c("近铁 · 生驹", "近鉄 · 生駒", "Kintetsu · Ikoma"), note: c("电车翻过生驹山，向奈良行进。", "電車は生駒の山を越えて奈良へ。", "The train climbs over the Ikoma hills toward Nara.") },
+          { time: "13:14", place: c("近铁 · 生驹", "近鉄 · 生駒", "Kintetsu · Ikoma"), note: c("电车翻过生驹山，向奈良行进。", "電車は生駒の山を越えて奈良へ。", "The train climbs over the Ikoma hills toward Nara.") },
```

**M3 —— `assets/js/data.js:1108`（整行删除）**

```diff
-          { time: "17:30", place: c("东大阪 · 下小阪", "東大阪 · 下小阪", "Higashiosaka · Shimo-Kosaka"), note: c("傍晚回到大阪东侧。", "夕方、大阪の東側へ戻る。", "Returning to eastern Osaka by early evening.") },
```

同时必须改同日 summary（zh 1091 / ja 1092 / en 1093），否则文案自相矛盾：

```diff
-          "中午从难波出发，近铁穿过生驹山把一天交给奈良；傍晚再沿原路回到大阪东侧。",
-          "昼は難波から近鉄で生駒の山を越えて奈良へ。夕方は同じ道を戻り、大阪の東側へ。",
-          "Leaving Namba at noon, a Kintetsu train crossed the Ikoma hills and handed the day to Nara; by evening the same line led back to eastern Osaka."
+          "中午从难波出发，近铁穿过生驹山把一天交给奈良；傍晚沿近铁奈良线原路返回，记录在东大阪一带中断。",
+          "昼は難波から近鉄で生駒の山を越えて奈良へ。夕方は近鉄奈良線で同じ道を戻り、東大阪付近で記録が途切れる。",
+          "Leaving Namba at noon, a Kintetsu train crossed the Ikoma hills and handed the day to Nara; by evening the same Nara Line carried the return, with the record ending around Higashiosaka."
```

**M4 —— `assets/js/data.js:1130`**

```diff
-          { time: "11:45", place: c("羽田机场", "羽田空港", "Haneda Airport"), note: c("航班把旅程带回东京。", "フライトが旅を東京へ連れ戻す。", "The flight carries the journey back to Tokyo.") },
+          { time: "11:56", place: c("羽田机场", "羽田空港", "Haneda Airport"), note: c("航班落地，把旅程带回东京。", "フライトが着陸し、旅を東京へ連れ戻す。", "The flight lands, carrying the journey back to Tokyo.") },
```

影响范围：三语专题页的足迹区块 + JSON-LD。注意事项：
- 改动后必须重跑 `npm run build`，让根目录与 `public/` 的三语页面同步
- `time` 字段被 `esc()` 转义后输出（`build-pages.mjs` 的 `tripFootprints`），不含用户输入，无 XSS 风险
- 时间格式是 `HH:MM` 或 `HH:MM–HH:MM`，改成别的形式不会影响校验（脚本不校验时间格式）

### 3.2 【可选】3 处微调

| # | 行号 | 现状 | 建议 | 实测 |
|---|---|---|---|---|
| O1 | 1081 | `19:20–20:40` 心斋桥东（约 80 分） | `19:47–20:41` | 停留实际 19:47–20:41（54 分）+ 20:42–20:59（17 分）；19:00–19:47 仍在移动 |
| O2 | 1107 | `15:40–16:25` 小西さくら通り（约 45 分） | `15:39–17:06`（87 分） | 实际停留 15:39–17:06 |
| O3 | 1128 | `08:45` 神户港岛 | `08:50` | 08:43 仍在三宫，港岛行驶在 08:45–09:00 之间 |

注意：O1/O2 若改时间区间，`note` 里的「约 80 分钟」「约 45 分钟」三语文案要同步改。

### 3.3 【必须，尚未动手】Pages Functions 路由缺口（生产 404）

**问题**：Pages 是文件路由，`worker.js` 的 `export default { fetch }` 在生产不执行。`handleAdmin`（`worker.js:575–800`）支持 21 个端点，但 `functions/api/admin/` 下只有 12 个文件。**以下 8 个端点在生产环境全部返回 404**，只有 `wrangler dev` 能用：

```text
/api/admin/profiles            GET/POST      （worker.js:673-680）
/api/admin/profiles/<host>     GET/PUT/DELETE（worker.js:681-695）
/api/admin/contacts            GET/PUT/POST  （worker.js:698-705）
/api/admin/content             GET/POST      （worker.js:708-717）
/api/admin/content/<id>        PUT/PATCH/DELETE（worker.js:718-732）
/api/admin/github/scan         POST          （worker.js:735-743）
/api/admin/github/import       POST          （worker.js:744-758）
/api/admin/ai-review           POST          （worker.js:761-772）
```

**推荐修法（一步到位）**：新增 `functions/api/admin/[[path]].js` 单一 catch-all：

```js
import { handleAdmin } from "../../../worker.js";

export function onRequest(context) {
  return handleAdmin(context.request, context.env, context);
}
```

依赖：`[[path]].js` 与已有的 `login.js` / `comments.js` 等具体文件并存时，Pages 优先匹配具体文件，不会冲突。
注意：修完必须加守卫测试，断言每个 `/api/admin/*` 路由都有可达入口。

### 3.4 其他已知待办（来自架构评审，本次未改）

| 项 | 位置 | 说明 |
|---|---|---|
| `site_events` 自动清理 | `worker.js:64` + `wrangler.jsonc` triggers | Pages 下 cron 不生效，只能靠后台手动按钮 |
| CSP 收紧 | `_headers:7` | 当前是 `Report-Only` + `'unsafe-inline'`，无实际拦截 |
| `test:site` 接回 check 链 | `package.json:10` | 目前是孤儿脚本 |
| `public/` 入库 | `.gitignore` | 358 个文件入库 + 根目录 HTML 既是产物又是输入 |
| admin 日文标题 bug | `admin.js:952-953` | 日/英标题都取 `form.get("title_zh")` |
| 3 张足迹插画 | `assets/images/japan-2026/footprints/` | 目录不存在，缺失时不阻断构建 |

---

## 4. 修改顺序与依赖

```text
① 修正 footprints 数据（M1–M4，可选 O1–O3）
   └─ 依赖：无。必须先做，因为它改的是 data.js 唯一数据源
      └─ 若做 M3，必须同时改 1091–1093 的 summary（否则文案矛盾）

② 重跑构建与校验
   └─ 依赖：①完成
      npm run build && npm run check
      └─ 会重建 public/，三语页面同步

③ 补 Pages Functions 路由（3.3）
   └─ 依赖：无，可与 ①并行
      └─ 但建议放在同一批提交里，避免线上后台功能长期 404

④ 提交
   └─ 依赖：①②③
      └─ 注意工作区里还混着 09-13 会话的 17 个文件，一并提交

⑤（可选）其余待办 3.4
   └─ 建议单独提交，与 ①②③ 解耦
```

**关键顺序约束**：M3（删 1108 行）与 summary 改写（1091–1093）必须同批完成，否则 07-12 的文案会声称「回到大阪东侧」但 stops 里没有对应条目。

---

## 5. 自查清单

### 5.1 语法与类型正确性

- [ ] `node --check assets/js/data.js` 通过（或 `npm run check` 的语法阶段通过）
- [ ] `footprints.days[].stops[]` 删除元素后，数组仍以 `]` 正确闭合，无遗留逗号
- [ ] `summary: c(...)` 的三个字符串参数数量仍为 3，无多余/缺失逗号
- [ ] 新增 `functions/api/admin/[[path]].js` 的相对路径层数正确（`../../../worker.js`）

### 5.2 边界与异常场景

- [ ] `footprints.days` 为空数组时，`tripFootprints()` 返回空串，页面不出现空区块（已由 `build-pages.mjs:495` 守卫）
- [ ] `day.image` 文件不存在时只输出文字不输出 `<figure>`（已由 `existsSync` 守卫）
- [ ] `day.stops` 为空数组时 `<ol>` 为空但结构合法
- [ ] 时间区间字符串含 `–`（U+2013 短横线），编辑时**不要误改成 `-` 或 `—`**
- [ ] `[[path]].js` 加入后，`/api/admin`（无子路径）是否仍能路由——需实测

### 5.3 逻辑一致性

- [ ] 每个 stop 的 `time` 在当天内**单调递增**（M2 改 13:30→13:14 后，与前一个 12:45、后一个 13:45 的先后关系仍成立）
- [ ] 07-12 的 summary 与 stops 表述一致（M3 的关键检查点）
- [ ] 07-13 的 `11:56` 与下一个 `12:00–12:30` 不重叠、不倒序
- [ ] 三语文案的**语义**一致，不只是都改了文字（ja/en 的「约 80 分钟」类数字要跟着改）

### 5.4 遗留引用（旧函数、旧变量、配置项、注释与文档）

- [ ] `docs/architecture/asset-delivery.md` 说「插画缺失时不发布空图」——与当前行为一致，无需改
- [ ] `docs/architecture/asset-delivery.md` 的行号引用（`data.js:1056-1136`）在改完后是否仍准确——**增删行会使其失效，需重算**
- [ ] 搜索全仓是否还有引用「下小阪 / Shimo-Kosaka」的地方
- [ ] 搜索是否还有引用旧时间「13:30」「11:45」「17:30」的注释或文档
- [ ] `admin.js` 里是否有依赖 `footprints` 结构的代码（目前没有，但加后台编辑时需同步）
- [ ] `verify-image-assets.mjs` 里硬编码的 `01-arrival-480.webp`、`15-last-view-1440.webp` 不受本次改动影响

### 5.5 风险与回滚

| 风险 | 等级 | 回滚方案 |
|---|---|---|
| 改坏 `data.js` 导致构建失败 | 中 | `git checkout -- assets/js/data.js`（注意：**会同时丢失 09-13 会话的全部 footprints 改动**，先 `git stash` 或复制备份） |
| `[[path]].js` 抢占了具体文件的路由 | 中 | 删除该文件即可，Pages 回退到原来的文件路由 |
| 三语页面不同步 | 低 | 重跑 `npm run build` |
| 插画补齐后 `verify-image-assets` 报尺寸错 | 低 | 插画必须是 1440×1800（4:5），否则校验失败 |

**回滚总原则**：`data.js` 的改动目前**没有提交**，回滚会连带丢失 footprints 功能。建议改之前先 `cp assets/js/data.js /tmp/data.js.bak`。

---

## 6. 验证与复现步骤

```powershell
cd D:\project\shuangyue-about

# 0. 备份（data.js 有未提交改动，务必先备份）
cp assets/js/data.js $env:TEMP\data.js.bak

# 1. 应用 M1–M4（按第 3.1 节的 diff）
#    若做 M3，同时改 1091–1093 的 summary

# 2. 语法与数据校验
node --check assets/js/data.js
node scripts/check-data.mjs
node scripts/check-i18n.mjs

# 3. 完整构建 + 全量检查
npm run build
npm run check

# 4. 确认三语页面都渲染了足迹，且时间是新值
Select-String -Path cities/japan-2026.html,en/cities/japan-2026.html,ja/cities/japan-2026.html -Pattern "13:14","11:56","18:28"
# 期望：每个文件各命中 3 次；且不应再出现 "13:30"、"11:45"、"17:30"、"下小阪"

# 5. 确认 public/ 与根目录同步
Select-String -Path public/cities/japan-2026.html -Pattern "13:14","11:56","18:28"

# 6.（若做了 3.3）本地验证 admin 端点路由
npx wrangler dev
# 分别请求 /api/admin/profiles、/api/admin/contacts、/api/admin/content、/api/admin/ai-review

# 7. 提交
git add -A
git commit -m "fix(footprints): 按 Google 时间轴 GPS 校正 4 处停留时间与地点"
git push origin main
# 生产由 Cloudflare Pages Git 集成自动部署，不要运行 wrangler deploy
```

**复现 GPS 核对**（如需重新验证）：

```python
# 解析 Timeline Edits.json：取 rawSignal.signal.position.point.latE7/lngE7（÷1e7）
# 时间戳取 signal.position.timestamp，转 JST 需 +9 小时
# 停留聚类：位移 <150m 且间隔 <8min 视为同一停留
```

---

## 7. 未解决 / 待确认问题

| # | 问题 | 状态 |
|---|---|---|
| 1 | **08-13 部署失败悬案**：Cloudflare 卡在 Deploying，已排除体积（134.69 MiB，低于历史成功的 136.95 MiB）、路径、文件数、Functions、Headers、LFS、构建配置，最后请求登录 Dashboard 查部署 `0109cb4d-ba67-4007-8744-e1a1cc853b94` 的 Build log | ❓ 从未闭环，需用户确认 |
| 2 | **3 张足迹插画未产出**：`assets/images/japan-2026/footprints/` 目录不存在；文档已写好规则但资产尚未创建 | ⏳ 待补 |
| 3 | **前 12 天路线无法用 GPS 验证**：时间轴只覆盖 7/11 18:28 – 7/13 16:43。已用照片水印索引（`E:\env\日本旅游_照片整理_2026-06-30至07-14\行程说明.md`）交叉验证，15 张海报 15/15 吻合，但这是水印推断而非 GPS | ⚠️ 已降低风险，非完全证实 |
| 4 | **照片归档目录名与 GPS 冲突**：`14_2026-07-13_神户三宫_大阪住宿` 写「大阪住宿」，实际当晚在东京蒲田。海报文案是对的，目录名错了 | ⏳ 是否要改归档目录名，待用户决定 |
| 5 | **test001 分支的限流改造被放弃**：`origin/test001`（`b9d4fea` / `6a99d4d` / `7b5d1b1`）有一整套已实现的限流方案，因 PR #4 冲突未合入 main。当前 main 的限流是另一套实现 | ❓ 是否需要移植，待用户决定 |
| 6 | **`.gitignore` 未忽略 `public/` 与 `assets/images/generated/`**：每次 build 产生数百文件 diff | ⏳ 建议做，但会改变仓库结构，待用户确认 |
| 7 | **日文文案 native review（优化报告 P3-4）**：尚未做 | ⏳ |
| 8 | **真机 NFC 联系人导入测试**（iOS/Android）：07-18 会话建议过，未做 | ⏳ |

---

## 附录：环境备忘

- 本机 Bash 工具首行会报 `dirname: command not found`，命令前需加 `export PATH="/usr/bin:/bin:$PATH";`
- PowerShell 工具输出为空（不可用），优先用 Bash + Read/Grep/Glob
- 操作 Cloudflare 需 `NODE_USE_ENV_PROXY=1`，否则 wrangler OAuth 卡死
- Node 走 `C:/Users/19702/.workbuddy/binaries/node/versions/22.22.2-3/node.exe`
