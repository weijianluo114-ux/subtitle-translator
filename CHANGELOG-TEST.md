# 更新日志 · 测试版（Test / Beta）

- 项目：**字幕整行翻译 / Subtitle Line Translator**（Chrome 扩展，Manifest V3）
- 适用分支：`test`（开发分支；功能稳定后再合并 `main` 上架）
- 版本号来源：`src/manifest.json` 的 `version` 字段
- 已上架版本的记录见 [CHANGELOG.md](CHANGELOG.md)（本文件包含正式版全部历史，另加开发中版本）

## 维护约定

1. 在 `test` 分支开发时，每次产生可测的新版本 / 修复，就把变化写进本文件。
2. 每个版本一节，**倒序排列**（最新在最上）；正式版已发布的版本小节保持与 `CHANGELOG.md` 一致。
3. 版本小节内按 `新增 / 修复 / 变更 / 文档` 归类；开发中版本标注分支与 commit。
4. 版本合并上架后，同步把该版本写进 `CHANGELOG.md`。

---

## 0.3.3 — 2026-09-18

**开发中，未上架。** 分支 `test`。对应 `docs/16-功能设计-音标与注音.md`（去掉拼音 + 内置离线 IPA 音标）。

### 新增

- **内置离线英文音标词典**：`src/data/ipa-en.tsv`（125,909 词条 / 134,996 读音，由 CMUdict 经 `tools/make_ipa_dict.py` 转成美式 IPA，含常用读音优先表）。
  - 气泡新增音标行（`.kt-tooltip-phonetic`，淡色小字），格式 `/ˈsentəmənt/`，多音词最多显示 2 个读音。
  - 查询链路：`inject.js`（MAIN）→ `kt-ipa-request` → `storage-bridge.js`（ISOLATED）→ 后台 `kt-ipa-lookup`（懒加载 TSV → Map）→ `kt-ipa-response`；页面侧 LRU 3000（`STATE.ipaCache`）+ 字幕块渲染时批量预取（`prefetchIpaForChunk`）。
  - **不新增任何权限、不新增任何网络请求**：音标纯本地查表。
- 弹窗「外观 → 翻译气泡」新增 **「显示音标」开关**（设置键 `showPhonetic`，默认开；关掉则不显示音标行、也不再预取）。

### 修复

- **气泡不再显示拼音**：此前 meta 行把 Google `sentences[].translit`（目标语言罗马化，如 `Qíngxù`）拼在最前面；现 meta 行只保留「解释」（Google `dict` 词条）。
- **音标不再使用 Google 的 respelling**：实测 Google `sentences[].src_translit` 不是词典音标（`additional → əˈdiSHənl`、`would → wo͝od`、`live → liv`，read/record/短语/整句常为空，16 词仅约 31% 可用），故英文词元一律改用内置词典；查不到时**不显示音标行**（不回退 Google，避免再次出现错误音标）。

### 变更

- 非英文词元（中文/日文源等）仍显示翻译接口返回的**源语言罗马化**（`data.transcription`），为空则不显示。
- 多选/短语（含空格的选择）不显示音标行，仅单个词显示。
- 诊断报告新增 `phonetic{enabled, cached, last{word, ipa, source}}` 字段，便于核对音标来源与命中。
- 隐私政策补充说明：音标使用内置离线词典，不联网、不发送数据（`PRIVACY.md` §3 中英双语；生效日期改为 2026-09-18）。

### 文档

- 新增 `docs/16-功能设计-音标与注音.md`（根因证据、转换规则、数据流、改动清单、验收清单）。
- `src/THIRD_PARTY_NOTICES.md` 新增「内置离线音标词典」小节，并随包保留 `src/data/CMUDICT-LICENSE.txt`（BSD-2-Clause 全文）。
- 版本号 `src/manifest.json` → **0.3.3**。

---

## 0.3.2 — 2026-09-16

**开发中，未上架。** 分支 `test`。对应 `docs/15-Bug追踪与排查记录.md` 的 **Bug #001**（悬停气泡不消失 / 多个气泡叠在一起 / 卡顿）。

### 修复

- **气泡/通知节点生命周期（多窗叠堆的根治）**：
  - 新增 `purgeOrphanNodes()`：页面上出现不属于当前状态的气泡/通知（孤儿节点）时直接删除；`ensureTooltip()`、`showNotification()`、`onSubtitleLeave()`、全屏切换、`resetForNewVideo()` 都会调用。
  - 存活判断由 `document.body.contains()` 改为 `isConnected !== false` + **幂等搬移**（`mountOverlayNode()`）：节点只搬移、不重建，不再出现"旧节点留在画面上没人管"的情况；断链节点直接删除后重建。
  - 新增 `selfHealOverlayNodes()`：指针看门狗每 100ms 顺带自愈（删孤儿、丢弃断链节点）。
- **全屏进出（`handleFullscreenChange`）**：改为统一的 `relocateOverlayNodes()`——全屏时气泡/通知挂到全屏元素下（原本挂在 `body` 里的节点在全屏时**根本不会渲染**，退出全屏又会"自己冒出来"），退出全屏搬回 `body`；同时把全屏宿主写入 `fullscreen_change` 日志。
- **气泡定位**：新增 `applyPositionMode()`——挂 `body` 时用 `absolute` + 文档坐标（跟随滚动，行为不变），挂全屏容器时用 `fixed` + 视口坐标，避免坐标基准错位。
- **暂停控制器 `pauseController.resume()`**：改为 **`play()` 成功后**才释放 claim；失败时记 `pause_resume_failed` 日志并弹提示（`resumeFailed`），不再出现"claim 已丢、视频永久卡在暂停且无提示"；新增 `resumePending` 防重入。换视频（`resetForNewVideo`）由 `destroy()`（只 release）改为 `resume()`（真正恢复播放）。
- **看门狗可见性判据**：`checkPointerState()` / 全屏日志由"仅看内联 `style.visibility`"改为"内联 visible 或带 `kt-visible` class"，避免只加了 class 的气泡永远不被清理。

### 变更

- **诊断报告（`buildDebugReport`）新增字段**：`dom{overlay,tooltip,notification,measurer,tooltipVisible}`（DOM 普查）、`video{paused,currentTime,duration,readyState}`、`tooltip{connected,host,stylePosition,...}`。
- **新增日志事件**：`tooltip_create` / `tooltip_hide{reason}` / `node_mount` / `orphan_purged{n}` / `tooltip_dropped` / `pause_claim` / `pause_resume` / `pause_resume_failed` / `cache_hit` / `cache_miss`。
- **翻译日志不再截断到 40 字符**：`translate_ok` / `translate_error` / `cache_miss` 记录 `len + fp(文本指纹) + 前 120 字符`，用于判断"同一整句短时间内多次走网络"是文本不同（正常）还是缓存未命中（bug）。

### 文档

- 新增 `docs/15-Bug追踪与排查记录.md`（本地私有）：Bug #001 完整排查过程 + Bug #002（全屏残留，`b19885e`）归档 + 编号规范 + "气泡类已知坑"清单。
- `tests/kt-core-test.mjs` 新增 6 条断言（挂载宿主跟随全屏、孤儿清理保留当前节点、幂等、搬移不产生副本）。

## 0.3.1 — 2026-09-11

**开发中，未上架。** 分支 `test`。

### 变更

- 「外观 → 文字透明度」由下拉框（仅 100% / 75% / 50%）改为**滑块**：范围 0–100、步进 5，右侧实时显示当前数值（如 `65%`），拖动即时生效、无需刷新。
- 取值归一化同步放开（`popup.js` 与 `inject.js`）：数值四舍五入到 5 的倍数并夹在 0–100，非法值回退默认 100；旧的 100 / 75 / 50 仍合法，**无需数据迁移**。

### 文档

- 新增 `docs/14-功能设计-文字透明度滑块.md`（本地私有）。
- `tests/kt-core-test.mjs` 新增透明度归一化断言（37→35、150→100、-10→0、非法→100、75 保持）。

## 0.3.0 — 2026-09-11

**开发中，待上架。** 分支 `test`，commits `664ca8a`（Worker 接收端）/ `46973a5`（扩展端）/ `6dd2de1`（配置）。

### 新增

- **用户反馈功能**（扩展 → Cloudflare Worker → D1 落库 → 飞书群通知）：
  - 弹窗新增「反馈 / 建议」按钮，打开独立的反馈页；支持类型选择（问题反馈 / 功能建议 / 其他）与 1–2000 字正文。
  - 可选「附上诊断信息」（**默认不勾选**）：扩展版本、浏览器版本、当前视频链接、最近 20 条调试日志；仅在勾选时才向 YouTube 标签页取数据。
  - 匿名单向：不收集姓名 / 邮箱 / 账号等身份信息，不做用户标识。
  - 发送失败自动暂存到本机（`chrome.storage.local`），下次打开反馈页自动填入并可重试；另提供「复制内容」兜底（网络不可用时手动反馈）。
  - 发送成功后 60 秒冷却，避免连点；中英双语界面（跟随设置里的界面语言）。
- Worker 接收端（`tools/feedback-worker/`，**不随扩展包发布**）：CORS 预检、字段白名单、2000 字上限、`sha256(IP+盐)` 限流（60 秒 1 条 / 24 小时 30 条）、先落库再推飞书（推送失败不丢反馈）、180 天自动清理。

### 变更

- `src/manifest.json`：版本 `0.2.0 → 0.3.0`；`host_permissions` 新增 `https://kt-feedback.weijianluo114.workers.dev/*`（仅此一项，**未新增 `tabs` 权限**——用已有 YouTube 主机权限做 URL 过滤 + `sendMessage` 采集诊断信息）。
- `src/storage-bridge.js`：新增 `kt-feedback-collect` 消息，返回当前视频链接与最近 20 条日志（仅在反馈页勾选诊断信息时调用）。

### 文档

- `PRIVACY.md` 新增第 10 节「用户反馈（自愿提交）」，并在第 1 / 3 / 4 / 7 节补充反馈相关说明（处理方 Cloudflare + 飞书、180 天保留、不可逆 IP 哈希、删除权）；生效日期更新为 2026-09-11。
- 商店材料更新：权限理由新增 Worker 域名一条、单一用途补充反馈入口、隐私问卷需勾选 `User-provided content` + `Web history`、新增两条审核问答、商店文案补充反馈亮点。

### 验收

- Worker 接口全部通过：`/health`、`OPTIONS` 预检（204 + CORS 头）、正常提交、60 秒内重复（429）、空正文（400）、2001 字（413）、未知路径（404）。
- 真机链路已通：代理开启时可发送，飞书群实时收到卡片，D1 记录 `delivered=1`；断网时提示网络异常并暂存到本机（符合设计）。

## 0.2.0 — 2026-09-06

**开发中，未上架。** 分支 `test`，commit `d4b222e`（功能）+ `b19885e`（修复）。

### 新增

- **完整句子翻译单元**（整句翻译不再被显示分块截断）：
  - 成句规则：句末标点（`.!?。！？…`）、下一个词是说话人标记（`>>` / `<<`）、词间停顿 ≥ 5s 硬切。
  - 太短合并：句长 < 4 词，或时长 < 0.8s 时，与下一句合并（最多合并 2 句）。
  - 太长截断：句长 > 40 词，或时长 > 5.2s 时，优先在逗号 / 分号 / 冒号处截断，剩余部分成为下一个翻译单元。
  - 悬停任一单词时，气泡中的「整句翻译」显示该词所属的翻译单元（二分定位），而不是当前显示块。
  - **显示分块本身完全不变**，只影响整句翻译的文本。

### 修复

- 全屏进出时主动清理气泡与暂停状态：新增 `fullscreenchange` 监听（取消悬停计时、中止翻译请求、清空选区、隐藏气泡、恢复被暂停的视频），退出全屏后把气泡节点移回 `body`；修复「鼠标移开 / 退出全屏后气泡仍在」的残留问题。
- 修复长句截断的边界 bug：整句刚好在最后一个词才超上限时不会被截断（`splitLongUnit` 收尾判断顺序错误）。

### 变更

- 诊断报告 `buildDebugReport` 新增字段：`tooltip`（是否存在 / 可见 / 挂载节点）、`pointer`（lastX / lastY / 是否全屏）、`polling`（看门狗是否在运行）、`pause`（是否持有暂停）、`selection`（已选词数 / 当前词）。
- `tests/kt-core-test.mjs` 新增回归用例：句子单元切分 / 合并 / 逗号截断 / 二分定位，共 33 条断言 `ALL PASS`。

## 0.1.17 — 2026-09-06

**首个 Chrome Web Store 上架版本。**

### 新增

- 悬停词与 Shift 多选词统一高亮：金色字形边缘发光 + 加粗 + 放大 1.12（贴合笔画，不再是灰色方框）。

### 文档

- `README.md` + `README.en.md` 中英双语，顶部互链 `Language: 中文 | English`。
- 公开完整隐私政策 `PRIVACY.md`（中英双语，9 节：收集 / 使用 / 第三方 Google+Bing+MyMemory / 存储保留 / 安全 / 儿童 / 权利 / 变更 / 联系），商店隐私政策 URL 指向该文件。
- 商店上架材料（仅本地私有，不入库）：4 张 1280×800 截图、中英文案、权限理由（含 mymemory 与 translate.google.com 说明）、素材清单。
- `docs/`、`store-listing/` 转为本地私有资料，并已从 GitHub 全部历史中清除、加入 `.gitignore`。

### 打包

- `dist/subtitle-translator-0.1.17.zip`（35 个文件：图标、6 套 OFL 字体、收款码、多语言等）。
- 另出 `dist/subtitle-translator-0.1.17-朋友测试版.zip`（含《安装说明.txt》，本地分发用）。

## 0.1.16 — 2026-09-06

### 变更

- 图标 v7：对讲机放大至贴近徽章外框（内区 96% 占用，两遍布局自动居中）。

## 0.1.15 — 2026-09-06

### 变更

- 图标 v6：对讲机整体自动居中并微调比例。

## 0.1.14 — 2026-09-06

### 变更

- 图标 v5：黄色横线与浮字整体包进深色机身，横线按浮字几何定位。

## 0.1.13 — 2026-09-06

### 变更

- 图标 v4：黄色横线移到浮字上方并左移，与浮字水平重叠。

## 0.1.12 — 2026-09-06

### 变更

- 图标 v3：去掉扬声器孔与旋钮，浮字左置并放大。

## 0.1.11 — 2026-09-06

### 变更

- 图标 v2：黄绿对角渐变徽章 + 深色外框，单个对讲机（天线在右）+ 黄色浮字。

## 0.1.10 — 2026-09-06

### 新增

- 首版新图标：蓝绿渐变对讲机（浮字 / T + 传输波纹，无边框）。
- 图标生成脚本 `tools/make_icons.py`，输出 16 / 32 / 48 / 128 四种尺寸。

## 0.1.9 — 2026-09-06

### 新增

- 诊断日志新增 `translate_ok`：记录翻译成功时的路径（页面直连 / 后台代理）与引擎，便于排查网络问题。

## 0.1.8 — 2026-09-06

### 修复

- 恢复「页面侧直连 Google 翻译」作为首选（走用户浏览器同款网络 / 代理），后台引擎链仅作兜底，改善国内网络下的连通率。

## 0.1.7 — 2026-09-06

### 新增

- **翻译总开关**：关闭后仅保留整行字幕显示，悬停翻译、自动暂停、高亮全部禁用（词节点 `pointer-events:none`，完全不触发）。
- **Shift 拖选多词**：按住 Shift 拖动扫过单词即多选，100ms 指针看门狗兜底不漏词，同时禁用原生文本选中。

## 0.1.6 — 2026-09-06

### 新增

- 新增 MyMemory 兜底翻译引擎（`api.mymemory.translated.net`，国内实测可达）。

### 变更

- 引擎选择改为「上次成功引擎优先」（`lastGoodEngine`），减少重复失败等待。

## 0.1.5 — 2026-09-06

### 修复

- Google 翻译增加备用域名 `translate.google.com`，双域名 × 3 个 client id（`dict-chrome-ex` / `at` / `gtx`）轮换，403/429 自动切换；失败兜底 Bing。

## 0.1.4 — 2026-09-06

### 修复

- 诊断报告下载改为「弹窗经桥接脚本拉取」，绕开页面 CSP 拦截。
- 翻译失败时气泡直接显示具体失败原因。

## 0.1.3 — 2026-09-06

### 新增

- 弹窗右上角新增「Buy me a coffee (for school fee)」收款码栏目（微信 / 支付宝）。
- README 附收款码。

## 0.1.2 — 2026-09-06

### 修复

- 修复字幕块切换时气泡 / 暂停状态卡住：整批替换词节点时主动清理 + 100ms 指针看门狗（`elementFromPoint` 兜底校验）。

### 新增

- 气泡文字支持加粗设置。

## 0.1.1 — 2026-09-06

### 修复

- 修复翻译气泡完全不可见（`positionTooltip` 中内联 `visibility:hidden` 优先级高于 class，导致永远不显示）。
- 翻译改走后台代理，绕开页面 CSP 拦截。

### 变更

- 词高亮从灰色方框改为贴合字形的金色边缘发光。

## 0.1.0 — 2026-09-06

**首个可用版本**（MV3，纯 JS 无构建，`src/` 可直接 Load unpacked）。

### 新增

- 融合方案 C：ketuvia 式自建覆盖层整行显示 + hover-translate 式悬停翻译 / 翻译时暂停。
- MAIN world 注入，patch `window.fetch` 与 `XMLHttpRequest`，拦截 YouTube `timedtext` 请求并强制 `fmt=json3`。
- 词元解析：自动字幕词元、手动字幕按字符占比插值、广播碎片（`GOING` / `TO`）拼接。
- 整行显示分块算法：句末标点 / 说话人 `>>` / 硬停顿 5s / 词数上限 40 / 时长 1.8–5.2s / 长停顿清屏 / 300ms 前瞻 / 100ms 轮询。
- 隐藏原生字幕（`.ytp-caption-window-container{visibility:hidden!important}`），自建 `#kt-overlay` 逐词 `span` 渲染。
- 悬停 200ms 防抖翻译；气泡跟随字幕 / 自定义外观；左键复制译文（默认）；Debug 调试模式。
- 无空格语言用 `Intl.Segmenter` 分词；Shift 多选。
- 翻译引擎：Google（`translate.googleapis.com` + 3 个 client id）、Bing 后台代理；词 / 整句两级 LRU 缓存（持久化到 `chrome.storage.local`）。
- 暂停控制器 claim 对账，避免误恢复用户手动暂停。
- 设置经 `documentElement.dataset` + 自定义事件实时同步；弹窗双标签「设置 / 外观」，19 种语言（首版仅 `zh_CN` + `en` 文案）。
- 工程配套：`build.py` 打包脚本、`tests/kt-core-test.mjs` 核心算法回归（Node `vm` 模拟 DOM）。
