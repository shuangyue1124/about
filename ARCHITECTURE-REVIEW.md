# 架构评审与重构建议

评审对象：`D:\project\shuangyue-about`（about.shuangyue.space）
代码规模：`worker.js` 2495 行 / `assets/js/*` 4190 行 / `scripts/*.mjs` 2517 行 / 生成页面 152 个
评审时间：2026-09-19

---

## 一、整体架构

### 1.1 分层

```
                      ┌─ 构建期（Node） ─────────────────┐
assets/js/data.js ──▶ │ optimize-images → build-pages   │ ──▶ 仓库根 HTML（zh/en/ja）
 (唯一数据源, 100KB)  │ → prepare-worker-assets          │ ──▶ public/（Pages 输出）
                      └─────────────────────────────────┘
                                    │ 静态 ESM import
                                    ▼
                      ┌─ 运行期 ─────────────────────────┐
浏览器 app.js/admin.js │  Pages Functions（18 个薄壳）     │
   ↕ /api/*           │    → worker.js（2495 行单体）     │
                      │       → D1 / KV / Workers AI      │
                      └──────────────────────────────────┘
```

### 1.2 主要逻辑

- **数据契约**：`assets/js/data.js` 用 ESM 导出 `languages / profile / ui / homeCards / contacts / cities / japanPlan / visualShapes`，是构建期与运行期**同一个**数据源。
- **静态优先**：`build-pages.mjs` 把三语正文完整渲染进 HTML，客户端 JS 只做交互增强；无 JS 时页面仍可用。`sw.js` 做 network-first + SWR 分层缓存。
- **API 单体**：`worker.js` 默认导出 `fetch` 路由 + `scheduled` 定时任务，并导出 9 个具名 handler（`handleComments / handleSite / handleContent / handleVcard / handleEvents / handleCspReport / handleAdmin` 等）。`functions/**/*.js` 每个约 140 字节，只做 `import → onRequest → handleXxx` 转发。
- **多域名档案**：按 Hostname（`about / wx / qq / github / travel.shuangyue.space`）过滤模块、联系方式、旅行城市和 vCard。
- **留言链路**：限流 → Turnstile → Workers AI 审核 → D1 落库 → KV 公开缓存（60s）→ 内存缓存（15s）→ Telegram 通知（`ctx.waitUntil`，失败不回滚）。
- **管理员**：密码派生 HMAC 签名的 HttpOnly Cookie（24h），非 GET 请求强制 `x-admin-action: 1` 自定义头。

### 1.3 值得肯定的设计

安全基线扎实：`timingSafeEqual` 比对签名、KV 键用 SHA-256 哈希 IP 不落明文、限流采用"先读全部窗口、被限流时只读不写"避免污染配额、`/api/events` 走纯内存计数（0 KV 写）、留言落库后 Telegram 失败不回滚不阻塞访客、非 GET 强制自定义头防 CSRF。静态优先 + 零前端框架依赖，与"弱网可用"的业务目标一致。注释质量高，大量解释了"为什么"。

**地基是对的。问题不在设计方向，在于增量改造持续叠加后缺少一次结构性收敛。**

---

## 二、严重问题（P0）

### 2.1 Pages Functions 路由缺口：生产环境一半后台功能是 404 ★最高优先级

Pages Functions 是**文件路由**，`worker.js` 的 `export default { fetch }` 路由器在 Pages 生产环境**根本不执行**（只在 `wrangler dev` 生效）。而 `handleAdmin` 支持 21 个端点，`functions/` 下只有 12 个 admin 文件：

| 端点 | worker.js | functions 文件 |
|---|---|---|
| `/api/admin/profiles` GET/POST | :673-680 | ❌ 缺失 |
| `/api/admin/profiles/<host>` GET/PUT/DELETE | :681-695 | ❌ 缺失 |
| `/api/admin/contacts` GET/PUT/POST | :698-705 | ❌ 缺失 |
| `/api/admin/content` GET/POST | :708-717 | ❌ 缺失 |
| `/api/admin/content/<id>` PUT/PATCH/DELETE | :718-732 | ❌ 缺失 |
| `/api/admin/github/scan` POST | :735-743 | ❌ 缺失 |
| `/api/admin/github/import` POST | :744-758 | ❌ 缺失 |
| `/api/admin/ai-review` POST | :761-772 | ❌ 缺失 |

后果：**多域名档案管理、联系人目录、内容条目（anime/games/github）、GitHub 扫描导入、AI 评审在生产环境全部返回 404**，只有 `wrangler dev` 能用。`admin.js` 里这些面板在本地一切正常，上线即失效。

### 2.2 动态 vCard 生产不生效

`worker.js:32` 为 `/contact.vcf` 做了按 Hostname 过滤的动态生成，靠 `run_worker_first: true` 抢在静态资源前。但 `run_worker_first` 是 `wrangler.jsonc` 的配置，Pages Git 集成**完全忽略** `wrangler.jsonc`。生产上 `/contact.vcf` 直接命中 `public/contact.vcf`（6 条硬编码联系方式），`_redirects` 又把 `/assets/shuofeng-shuanyue.vcf` 301 到它。README 第 28-31 行的描述与生产行为不符。

### 2.3 生成物污染源码，且 `public/` 全部入库

- `optimize-images.mjs` 把 WebP 写回 `assets/images/`（**134 个生成文件在 git 里**）
- `build-pages.mjs` 把 HTML 写回**仓库根目录**（`index.html`、`en/`、`ja/`、`cities/`、`travel/`、`sitemap.xml`）
- `public/` **358 个文件在 git 里**
- `.gitignore` 只忽略 `.wrangler/`、`node_modules/`、`.reasonix/`

结果：根目录 HTML 既是**产物**又是 `public/` 的**输入**，双向流动；每次 `npm run build` 产生数百文件 diff（当前 `git status` 就有 `scripts/` 与 `public/` 同名文件同时 Modified）；无法判断哪份是权威；code review 被噪声淹没；"不要手工修改 `public/`"的约定只能靠 AGENTS.md 口头约束。

### 2.4 `worker.js` 是 2495 行单体

110+ 个顶层函数，混杂 9 个职责域：HTTP 路由、多域名档案、评论 CRUD、内容 CRUD、D1 建表、KV/内存缓存、Telegram、AI 审核与对话、管理员鉴权、限流、vCard、地理信息。单文件已超出可安全修改的认知边界。

---

## 三、结构性问题（P1）

### 3.1 逻辑 N 份拷贝

`worker.js:153` 的注释自己承认："Keep in sync with assets/js/site-profile.js (same defaults + sanitizers)"。实际拷贝数更多：

| 概念 | 拷贝位置 |
|---|---|
| `MODULE_IDS` | `worker.js:164` ≡ `site-profile.js:18` ≡ `admin.js:506` |
| `CONTACT_TYPES` | `worker.js:165` ≡ `site-profile.js:20-35` ≡ `admin.js:507` |
| `defaultProfileFor` | `worker.js:195-217` ≡ `site-profile.js` |
| `esc()` | `app.js:187-194` ≡ `admin.js:47-54` |
| `commentTime` | `app.js:985-995` ≡ `admin.js:494-504`（后者硬编码 `zh-CN`） |
| `commentLocation` | `app.js:979-983` ≡ `admin.js:489-492`（绕过 i18n） |
| 版本串 `20260913-multisite` | `build-pages.mjs:9` / `verify-image-assets.mjs:9` / `admin-d1.js:1` / `admin.html:17` / `manage.html:17` / `sw.js:1`（**6 处手工同步**） |

任何一处漂移都是静默不一致。

### 3.2 `data.js` 不是纯数据

模块加载期就有副作用：

```js
1274: cities.push(...pendingCities);      // mutate 已导出的数组
1435: cities.forEach(enrichStop);         // 再次 mutate
1437: Object.assign(japanPlan, { ... });  // mutate 已导出的对象
```

且内含函数 `c()` / `enrichStop()` / `textFirst()` / `textLang()`。后果：导入即改写共享对象；构建期与运行期共享同一个可变引用；无法 tree-shake——`app.js` 只要 `languages` + `ui`，`admin.js` 只要 `cities`，但两者都要下载完整 100KB `data.js`（`app.js:1`、`admin.js:1`）。对一个主打"移动端与弱网"的 NFC 名片站，这是实打实的首屏成本。

### 3.3 构建与校验脚本重复、且有孤儿

- `errors=[] + fail()` 样板 6 份 4 种风格：`check-data.mjs:5` / `check-i18n.mjs:4` / `check-seo.mjs:81` / `verify-image-assets.mjs:13` / `check-schedule.mjs:187` / `check-site-profiles.mjs:13`
- `textOf`：`check-data.mjs:10-12` ≡ `check-i18n.mjs:37-39`
- `tagAttr`：`check-links.mjs:17-20` ≡ `check-seo.mjs:36-39`
- `sitemapUrls`：`check-seo.mjs:7-10` ≡ `test-site.mjs:57-60`
- 语言列表硬编码 4+ 处，而 `build-pages.mjs:5` import 的 `languages` **根本没被使用**
- 根路径解析两套：`resolve(".")`（依赖 CWD）vs `fileURLToPath`
- **`npm run test:site` 不在 `npm run check` 链里**（`package.json:10`），`test-site.mjs` 是孤儿脚本
- 两套自研 KV/D1 mock：`test-site.mjs:95-139` 与 `check-site-profiles.mjs:128-235`，后者靠 `this._sql.includes(...)` **字符串匹配**分派 SQL（:142/:184/:196/:220）——改一个 SQL 关键字就静默失配，给出假绿

### 3.4 校验盲区

- `check-seo.mjs:83` 只遍历 sitemap → `admin.html` / `manage.html` **永不被 SEO 检查**
- `check-links.mjs:94` 只扫 `public/` → 根目录 HTML 的断链无人管
- `esc()`（`build-pages.mjs:28-33`）只转 `& < >`，**不转义引号**；JSON-LD 在 `:152` 直接 `JSON.stringify` 塞进 `<script>`，字段含 `</script>` 即可闭合逃逸
- 大量文案硬编码在生成器里、绕过 `ui` 字典：`build-pages.mjs:70 / 253-254 / 305-311 / 408-417 / 535-539`，`check-i18n` 完全管不到；`:254` 只有 zh/en 两支，**日文页会显示中文**
- 无 schema 校验（依赖只有 sharp + wrangler）。结构非法时静默产出空串（`build-pages.mjs:20` 的 `|| ""`），甚至拼出字面量 `undefined`

### 3.5 `admin.js` 上帝文件 + 状态同步缺陷

- `dashboard()` 一个 181 行模板串（:138-318）；`bind()` 70 行 30+ 绑定（:602-671）；`render()` 全量 `innerHTML` 重建后全量重绑
- **城市勾选只存在于 DOM checkbox**（:674-679 直接改 `c.checked`），`state` 无副本，而 `rebindCityCheckboxes()`（:673）**是空函数** → 全量 render 后勾选被重置
- `logout`（:701-709）只重置 5 个字段，漏掉 `profiles / contentItems / chatMessages / githubCandidates / editingProfile` → 退出登录后残留上一位状态
- **真实 bug**：`admin.js:952-953` 日/英标题都取 `form.get("title_zh")` → 新增域名的日文/英文标题被中文覆盖
- `admin.js:515 / 522` 的 `p.modules / p.contacts / p.travel.cities` 未转义直接进 `innerHTML`

### 3.6 前端其他可维护性问题

- 错误处理三种互不兼容风格：`admin.js:692` throw Error / `app.js:491` throw 字面量 / `app.js:718` throw Error；`app.js:748-750`、`:789`、`:830`、`:662` 静默吞异常（站点设置失败**完全无提示**）
- `app.js:949` 的 `href` 只 `esc()` 无 scheme 白名单，与 `:882/:885` 的 `startsWith("http")/("mailto:")` 校验不一致 → `javascript:` 可注入
- 魔法数字散落：`app.js:598 45000`、`:435 2600`、`:347 1400`、`:311 48`；`admin.js:6 60000`、`:814 {days:90}`
- `schedule.js:277-335` 的 `statusText` 把 `l==="en"?…:l==="ja"?…:…` 三元链重复约 20 次

---

## 四、潜在缺陷（P2）

**安全**
- CSP 是 `Report-Only` + `'unsafe-inline'`（`_headers:7`）→ 无实际拦截能力
- 公开显示留言者 IP 与归属地（README:100 自己已提示隐私风险）
- 管理员 Cookie 签名密钥**直接就是** `ADMIN_PASSWORD` 原文（`worker.js:2089`），无 KDF 迭代；改密码即全员登出
- `rateLimitCheck` 在无 KV 绑定时直接放行（:2470）→ 绑定缺失时限流**全部失效**（fail-open）
- `/api/events` 限流只在 isolate 内存，N 个 isolate 实际限额变为 N×60/分钟

**数据 / 运维**
- `scheduled()` 定时任务在 Pages 下不生效（`worker.js:64` 与 `wrangler.jsonc` triggers 均被忽略），`site_events` 只能靠后台手动按钮清理，忘记即无限增长
- `ensureSchema()` 在运行时建表（`worker.js:874-966`），与 `migrations/*.sql` 是**两份 DDL**，仅靠 `RUNTIME_SCHEMA_BOOTSTRAP` 门控，已经存在漂移风险
- 无迁移版本表，全靠 `CREATE TABLE IF NOT EXISTS`；`memory.schemaReady` 是 per-isolate 布尔且永不失效
- 内存缓存（`comments 60s / config 60s / profiles 60s`）无跨 isolate 主动失效机制

**冗余**
- `manage.html` 与 `admin.html` **逐字节相同**（均 19 行），纯别名页
- `admin-d1.js`（1 行 shim）在 `_headers:18-19` 已给 `admin.js` 设 `no-cache` 的前提下冗余，且版本号要手工同步 6 处

**依赖**
- `sharp` 放在 `dependencies`（应在 `devDependencies`），顶层静态 import 无 try/catch、无 optionalDependencies 降级 → 缺预编译二进制的环境直接 `ERR_MODULE_NOT_FOUND` 崩溃，不是优雅降级

---

## 五、可优化性评估

**结论：可优化性高。**

支撑判断的有利因素：无前端框架锁定、无运行时依赖、纯 ESM、业务域边界清晰（档案 / 评论 / 内容 / 统计 / 后台）、已有一套覆盖面广的自检脚本、注释解释了大量决策理由。这意味着重构不需要推翻架构，只需要**收敛重复 + 拆开单体 + 补上契约校验**。

主要阻力：`public/` 与根目录产物入库导致每次改动 diff 巨大；两份 DDL、两套 mock、N 份常量拷贝意味着任何一处修改都要多处同步；`functions/` 文件路由与 `worker.js` 路由是两套独立机制且已失配——这三点是重构前必须先止血的。

**建议投入**：阶段 0 约 1-2 天（止血），阶段 1 约 1 周（拆单体），阶段 2 约 1 周（数据契约与构建），阶段 3 约 2 周（测试与前端）。阶段 0 应优先于任何新功能开发。

---

## 六、优化方向与改进建议

### 阶段 0：止血（1-2 天）

1. **补 Pages Functions 文件**，或更根本地——把整个 admin 子树收敛成一个 catch-all：
   ```
   functions/api/admin/[[path]].js   →  handleAdmin(request, env, ctx)
   ```
   一步消除"新增端点必须记得加文件"的隐患。其余非 admin 端点保留现有单文件即可。
2. **加守卫测试**：断言 `worker.js` 里每个 `/api/admin/*` 路由在 `functions/` 下都有可达入口（将来直接防住 2.1 复发）。
3. 修 `admin.js:952-953` 的 `title_zh` bug；补 `admin.js:515/522` 转义、`app.js:949` URL scheme 白名单。
4. `.gitignore` 加 `public/` 与 `assets/images/generated/`（或把产物统一输出到 `dist/` 再复制）。
5. 把 `test:site` 接回 `check` 链（`package.json:10`）。
6. 修正 README 第 28-31 行关于 `/contact.vcf` 动态生成的描述，或改用 `/api/contact.vcf` 作为唯一入口。

### 阶段 1：拆分 `worker.js`（约 1 周）

```
src/server/
  router.js                       # 仅路由表
  handlers/{site,content,comments,events,vcard,csp,admin}.js
  domain/{profiles,contacts,content-items,comments,stats}.js   # D1 访问层
  infra/{db,kv,cache,ratelimit,secrets,telegram,ai,geo}.js
  http/{json,headers,session,cookies}.js
src/shared/                       # ★ worker 与浏览器共用，消灭 N 份拷贝
  constants.js                    # MODULE_IDS / CONTACT_TYPES / LANGS / 限值
  profile.js                      # defaultProfileFor / sanitizeProfile
worker.js                         # 仅 re-export，functions/ 薄壳保持不变
```
关键是 `src/shared/` 被**两侧真正 import**，而不是继续靠注释约定同步。`worker.js` 保留为兼容入口，让 `functions/**` 的 18 个薄壳无需改动，降低迁移风险。

### 阶段 2：数据契约与构建（约 1 周）

- `data.js` 拆为 `data/` 目录 + `schema.js` 强校验（zod 或自研轻量实现），构建前失败即中断，替代现在的"静默产出 `undefined`"
- 消除加载期 mutate：导出纯函数 `getCities()`，或在构建期把 enrich 结果直接写进产物
- 按入口拆分数据，避免 100KB 整包下发：首页只取 `ui + profile`，`cities/japanPlan` 改由 `/api/content` 按需取
- 构建产物只写 `public/`；根目录 HTML 明确为产物并 gitignore
- 提取 `scripts/lib/`：`root` 解析、`LANGS`、`fail` 收集、data 加载、sitemap 解析
- `entries` / `nonPublishedImagePaths` / 版本号改为从单一 manifest 生成（新增目录只改一处）
- JSON-LD 走 `</script` 转义；`build-pages.mjs` 里硬编码的三语文案全部收回 `ui` 字典，让 `check-i18n` 能覆盖
- `sharp` 移入 `devDependencies` + `optionalDependencies` 降级；缺 sharp 时跳过图片步骤而非崩溃

### 阶段 3：测试与前端（约 2 周）

- 用 `node:test` 统一测试框架，抽**一套**共享 KV/D1 fake，替换两套自研 mock 与 SQL 字符串匹配分派
- 给 `handleAdmin` 路由表加单元测试；`check-schedule.mjs` 的断言改为匹配语义标记而非整句文案
- 前端抽 `lib/escape.js` / `lib/api.js`（统一 fetch 与错误）/ `lib/i18n.js`（三语 fallback）/ `lib/datetime.js`
- `admin.js` 引入极简状态-渲染分离；补齐 `rebindCityCheckboxes()`；`logout` 全量 reset；`dashboard()` 拆成多个 render 片段
- `check-seo` / `check-links` 覆盖 `admin.html` / `manage.html` 与根目录 HTML

### 长期

- 观察 `/api/csp-report` 报告后，把 CSP 从 `Report-Only` 收紧为正式策略，去掉 `'unsafe-inline'`
- 引入迁移版本表，单一 DDL 源，删除 `ensureSchema()` 的运行时建表
- 考虑把留言者 IP / 归属地改为仅后台可见
- 删除 `manage.html` 别名页与 `admin-d1.js` shim（或让版本号自动注入）

---

## 处理状态（2026-09-19 已执行）

| 问题 | 结果 |
|---|---|
| 2.1 Pages Functions 路由缺口 | 已补 `functions/api/admin/[[path]].js` 兜底；新增 `scripts/check-functions-routes.mjs`（`check:routes`）在每次 `npm run check` 断言所有 `/api/...` 路径都有可达入口 |
| 2.3 `public/` 全部入库 | `.gitignore` 已排除 `public/` 与 `assets/images/generated/`，两者均由 `npm run build` 重建 |
| 3.3 孤儿脚本 `test:site` | 已接回 check 链 |
| 4.x `admin.js` 日/英标题取 `title_zh` | 已修，并补 ja/en 表单输入框 |
| site_events 清理依赖 cron | 新增写入侧抽样清理（`maybeCleanupEvents`，1/40 概率），Pages 上真正自动生效 |
| CSP 只报告不拦截 | 已改为正式策略；`script-src`/`style-src` 仍保留 `'unsafe-inline'`。要彻底去掉需先消除内联 `style=` 属性、JSON-LD 与主题初始化脚本 |

未处理：2.2 动态 vCard、2.4 `worker.js` 拆分、3.1 逻辑拷贝、3.2 `data.js` 副作用、3.5 `admin.js` 拆分，均属较大重构，建议按阶段单独做。
