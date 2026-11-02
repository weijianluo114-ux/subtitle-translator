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

## 0.4.1 — 2026-11-02

**开发中，未上架。** 分支 `test`。修复 0.4.0 用户实测「三个词典都下载失败」的问题。

### 修复

- **下载失败 `One of the specified object stores was not found`**（用户实测三条词典全部失败）。
  - **根因**：`src/dict.js` 建库时 `onupgradeneeded` 只创建了 `shards` store，漏建 `meta` store。用户机器上已经存在版本 1 的 `kt-dict` 库（只有 shards），而打开时用的还是 `DB_VERSION = 1` —— 版本号没变就不会触发 `onupgradeneeded`，所以 `meta` 永远补不上；等 32 个分片全部下载写完之后，`idbPut(STORE_META, ...)` 才抛错，表现为「下载到 100% 然后失败」。
  - **修复一：版本号 1 → 2**，强制触发一次升级，在 `onupgradeneeded` 里同时创建 `shards` 与 `meta`。
  - **修复二：打开后自愈**，`openDb()` 的 `onsuccess` 里检查两个 store 是否都在，缺任一则 `db.close()` 并按 `db.version + 1` 用新增的 `openDbWithVersion()` 重开一次（含 `onblocked` 处理），即使升级曾被中断也能恢复。
  - **修复三：fail-fast**，新增 `ensureStores()` 并在 `installDict` 最开头调用，store 不全时立刻返回 `local-db-incomplete`，不再让用户白等 30 秒下载完才发现失败。
  - **修复四：错误说人话**，弹窗新增 `humanizeDictError()`，把 IDB/校验/网络等技术报错翻成中英文可操作提示（`dictErrDb`/`dictErrChecksum`/`dictErrNetwork`/`dictErrUnknown`）。

### 新增

- 打赏面板（`☕`）底部新增 **GitHub Star 邀请**：一句「如果它帮到了你，喜欢的话也可以点个 Star ⭐」+ 可点击的仓库链接（新标签打开）。中英文文案随界面语言切换。

### 变更

- `src/manifest.json`：版本 `0.4.0 → 0.4.1`。
- 升级**不会丢掉已下载的分片**：自愈路径只补建缺失的 store，不清空 `shards`；因此 0.4.0 下已经下载成功的部分可直接续传。

### 测试

- 新增 `tests/kt-dict-idb-test.mjs`（**9 条断言 ALL PASS**），用可配置版本的假 IndexedDB 复现该 bug 并验证修复：
  - 全新库（版本 0）打开后 `shards` 与 `meta` 都在；
  - 构造历史 v1 库（只有 `shards`）→ **先复现原始报错**，再用 `dict.js` 打开 → 自动补齐 `meta`；
  - 已写入 `shards` 的分片数据在升级后**仍然存在**（不被清空）；
  - 库版本被升到 2，升级后 `dictStatus()` 可正常读取；
  - store 不可用时 `installDict` 立即失败，报错信息明确。

## 0.4.0 — 2026-11-02

**开发中，未上架。** 分支 `test`。可选离线词典（下载即用、离线优先）。

### 新增

- **可选离线词典下载（三项，各自独立下载/删除）**
  | id | 词典 | 词条 | 许可 | 角色 | 体积（32 分片 gz） |
  | --- | --- | --- | --- | --- | --- |
  | `ecdict` | ECDICT 英汉 | 401,606 | MIT | **主选** | 8.99 MB |
  | `wordnet` | WordNet 3.1 英英 | 82,810 | WordNet License | 备用 | 2.87 MB |
  | `cedict` | CC-CEDICT 汉英 | 198,553 | CC BY-SA 4.0 | 备用 | 6.33 MB |
- **词典不打包进扩展**（否则商店包 +18 MB）：改为按需下载，存进扩展源 IndexedDB（库 `kt-dict`，store `shards`/`meta`，键 `<dictId>:<bucket>`）。扩展包体积仅 +约 20 KB（清单）。
- **分片方案**：每词典切 32 个 `<bucket>.tsv.gz`，`bucket = fnv1a(key) % 32`（与 Python 端逐 UTF-16 码元一致，JS 端必须用 `Math.imul` 才不丢精度）。只查命中的那一片，解压后可 LRU 缓存 8 片。
- **离线优先**：命中离线词典时**不再发任何网络翻译请求**，直接显示离线释义；未命中才走 Google/Bing/MyMemory。设置键 `offlineDict`（默认开）、`dictSource`（`auto`/`offline`/`online`）。
- **网络失败兜底**：在线翻译失败时若离线有词条，就用中文释义顶替「词译文」，并在 meta 行标注 `[ECDICT] 离线释义`，让用户能分辨这不是在线结果。
- **查表归一化**：小写 → 去首尾标点 → 所有格/缩写回退（`word's → word`）→ 连字符回退（`well-known → wellknown → known`）。中文词走 CC-CEDICT，英文词走 ECDICT → WordNet。
- **弹窗 UI（设置面板 →「离线词典」组）**：总开关、三项词典卡片（名称/条目数/体积/许可/状态/下载-删除按钮）、逐片进度条与百分比、可选「下载镜像」输入框、合规说明文案。
- **进度走长连接端口**：`chrome.runtime.connect({name:'kt-dict-progress'})` 逐片回传 `{type:'progress'|'done'|'error'}`；单次 `sendResponse` 只能回一条，下载几十秒会被截断。
- **断点续传**：已下载且 sha256 匹配的分片直接跳过，中断后再点「下载」不用从头再来；「重新下载」按钮走 `force` 分支，先清空再全量重取（用于词典版本更新或本地损坏）。
- **页面侧词条缓存**：同一集内反复悬停同一词不再跨进程往返（LRU 600，未命中记 `null` 也缓存）；切换词典开关/优先级时自动清空，避免"关掉了还显示离线释义"。

### 修复

- 修正 **FNV-1a 乘法精度**：`h * 0x01000193` 超过 2^53，普通乘法会丢精度，导致 JS 与 Python 的 hash 不一致（实测 9 个样本全部 bucket 错位）。改用 `Math.imul` 后逐一对齐。

### 变更

- `src/manifest.json`：版本 `0.3.3 → 0.4.0`；`host_permissions` 新增 `https://cdn.jsdelivr.net/*`、`https://raw.githubusercontent.com/*`（仅用于下载词典分片）。
- 新增 `src/dict.js`（后台共享模块：hash/归一化/gzip/sha256/IndexedDB/清单/安装），由 `background.js` 用 `importScripts('dict.js')` 载入；**不注入页面**，页面侧只通过 `kt-dict-request` → `storage-bridge` → `kt-dict` 转发。
- `src/background.js` 新增 `kt-dict` 消息分支（`status`/`catalog`/`lookup`/`install`/`remove`）与 `kt-dict-progress` 端口。
- `src/inject.js` 新增 `requestDictLookup`/`lookupOfflineOrOnline`/`parseDictBody`/`formatOfflineGloss`/`dictSourceLabel`，并把词翻译统一收敛到 `resolveWordTranslation`（悬停与左键复制共用同一条离线优先链路）。
- 新增 `tools/build_dicts.py`（可复现生成脚本：`--download` 拉源、`--only` 单独重建；同时输出 `dicts/catalog.json` 与随扩展分发的 `src/data/dict-catalog.json`）。

### 文档

- `src/THIRD_PARTY_NOTICES.md`：新增三词典署名、许可与来源，补充「只下载不上传」的数据流向；许可全文随包分发（`src/data/ECDICT-LICENSE.txt`、`WORDNET-LICENSE.txt`、`CC-BY-SA-4.0.txt`）。
- `PRIVACY.md`：新增 §11「可选离线词典（下载与本地存储）」中英双语，§1/§3 补充下载域名（jsDelivr / GitHub Raw / 自填镜像）与「查词完全本地、不上传」；生效日期改 2026-11-02。
- `tests/kt-core-test.mjs`：新增第 18 组「离线词典」**67 条断言**（hash 与 Python 的 9 组样本对照、归一化/回退、`dictSource` 词典顺序、清单条目数与分片数一致、分片文件存在性、`00` 分片 sha256 校验、端到端「bucketOf → 解压 → 查表」含中文校验、页面侧词条缓存 LRU 与设置联动）；总数 **144 条 ALL PASS**。
- 词典包已发布到仓库 orphan 分支 `dict-v1`（98 个文件，19 MB）：`cdn.jsdelivr.net/gh/weijianluo114-ux/subtitle-translator@dict-v1/dicts`，实测分片 `ecdict/1c.tsv.gz` sha256 与清单一致，`raw.githubusercontent.com` 回退路径同样可访问。

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
