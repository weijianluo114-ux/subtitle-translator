# 隐私政策 / Privacy Policy（完整版）

**适用产品**：字幕整行翻译 / Subtitle Line Translator（Chrome 扩展）
**生效日期 / Last updated**：2026-11-02

---

## 中文版

### 1. 我们收集什么信息
- **不收集任何个人身份信息**：我们不收集、不存储、不上传你的姓名、邮箱、位置、设备标识、浏览历史等。
- 扩展仅在**本地**读取 YouTube 页面自身的字幕数据，用于"整行字幕显示"。
- 翻译功能：仅当你**主动把鼠标悬停在字幕单词上**时，被悬停的单词/短语与当前整行字幕文本会发送给翻译服务（见第 3 条）。
- **用户反馈（完全自愿）**：仅当你主动在扩展内点击「反馈 / 建议」并发送时，才会把你填写的内容发送给我们；你可选择（默认**不勾选**）附带少量诊断信息（扩展版本、浏览器版本、当前视频链接、最近 20 条调试日志）。详见第 10 条。
- **可选离线词典（完全自愿、默认不下载）**：扩展本体**不包含**词典数据。只有你在设置里主动点击「下载」时，扩展才会从 CDN 取回词典分片并保存在本机；下载过程中**只下载词典文件，不上传你的任何内容（不发送字幕、不发送查询词）**。详见第 3 条与第 11 条。

### 2. 信息如何使用
- 仅用于提供核心功能（整行字幕显示、悬停翻译、整句翻译）。
- 不用于广告、用户画像、数据分析或出售。

### 3. 第三方服务
翻译文本会发送给以下第三方翻译服务（按可用性自动选择）：
- **Google Translate**（translate.googleapis.com / translate.google.com）——默认引擎；
- **Bing Translator**（www.bing.com）——用户选择或 Google 不可用时的兜底；
- **MyMemory**（api.mymemory.translated.net）——前两者均不可达时的最后兜底。

**英文音标**：使用**内置于扩展的离线词典**（CMUdict 转换产物），纯本地查表，**不联网、不向任何第三方发送数据**。

**可选离线词典的下载来源**（仅在你主动下载时联系，且只做「下载」这一个动作）：
- **jsDelivr CDN**（cdn.jsdelivr.net）——默认下载地址，托管本项目的 `dict-v1` 词典包；
- **GitHub Raw**（raw.githubusercontent.com）——CDN 不可达时的备用地址；
- 你也可以在设置里**自填镜像地址**，此时只会联系你自己填的地址。

下载完成后的查词**完全在本机进行**（扩展源 IndexedDB），**不会**把查询的单词或字幕发给上述任何一方，也不经过任何翻译服务。

这些第三方按其自身的隐私政策处理收到的文本。

**用户反馈的接收与转发**（仅在你主动提交反馈时）：
- **Cloudflare Workers / D1**——接收并存储反馈内容（服务端数据库）；
- **飞书（Feishu）**——把反馈以消息形式推送给开发者。

### 4. 数据存储与保留
- 设置与翻译缓存仅保存在浏览器本地（chrome.storage.local），不设服务器；
- 我们不保留任何翻译文本副本；
- 清除浏览器数据即删除全部本地缓存；
- 你主动提交的用户反馈（含可选的诊断信息）会存储在服务端数据库中，保留最长 **180 天**后自动删除；用于防滥用的**不可逆 IP 哈希**随记录一并删除。

### 5. 安全
- 所有网络请求均通过 HTTPS；
- 无账号体系，不涉及登录凭据。

### 6. 儿童隐私
- 本扩展不面向 13 岁以下儿童，也不收集任何个人信息。

### 7. 你的权利
- 你可随时在扩展设置中关闭翻译功能；
- 你可随时清除浏览器本地数据；
- 若你提交过反馈并希望删除，可通过第 9 条的联系方式联系我们，我们会删除对应记录。

### 8. 政策变更
- 本政策如有更新，将发布在公开仓库的 PRIVACY.md 页面。

### 9. 联系方式
- https://github.com/weijianluo114-ux/subtitle-translator/issues

### 10. 用户反馈（自愿提交）
- 你可以在扩展内点击「反馈 / 建议」提交问题或建议，**完全自愿、匿名**：无需登录，我们不收集你的姓名、邮箱、账号等任何身份信息。
- 发送内容包括：你填写的反馈类型与正文；如果你**主动勾选**「附上诊断信息」，还会包含扩展版本、浏览器版本、当前视频链接，以及最近 20 条调试日志。
- 我们还会记录一个**不可逆的 IP 哈希**（仅用于限流防滥用，无法还原为你的 IP 地址），它会在 180 天后随反馈记录一起删除。
- 反馈仅用于修复问题与改进功能，不用于广告、用户画像或出售。
- 处理方：Cloudflare（存储与转发）、飞书（消息通知）。

### 11. 可选离线词典（下载与本地存储）
- **默认不下载**：扩展安装后不包含、也不会自动下载任何词典数据；不下载时该功能完全不生效。
- **你会得到什么**：三项开源词典（ECDICT 英汉 401,606 词条 / WordNet 3.1 英英 82,810 词条 / CC-CEDICT 汉英 198,553 词条），可在设置里单独下载或删除。
- **存储位置与大小**：保存在你本机的扩展源 IndexedDB（数据库名 `kt-dict`），三项全部下载约 18 MB；卸载扩展或点击「删除」即随之清除。
- **不上传**：下载过程只发送对词典文件的 GET 请求；不做遥测、不上报下载结果、不发送查询词。
- **许可**：三项词典均为开源许可（MIT / WordNet License / CC BY-SA 4.0），署名与许可全文随扩展提供，见 `THIRD_PARTY_NOTICES.md` 与 `src/data/*-LICENSE.txt`。

---

## English

### 1. Information We Collect
- **No personally identifiable information**: we do not collect, store, or transmit your name, email, location, device identifiers, or browsing history.
- The extension reads YouTube's own caption data **locally** to render full-line captions.
- Translation: only when you **actively hover over a subtitle word**, the hovered word/phrase and the current caption line are sent to a translation service (see Section 3).
- **User feedback (entirely voluntary)**: only when you click "Feedback" in the extension and press send do we receive the message you typed; you may optionally (**unchecked by default**) attach limited diagnostics (extension version, browser version, current video URL, last 20 debug logs). See Section 10.
- **Optional offline dictionaries (entirely voluntary, not downloaded by default)**: no dictionary data is bundled with the extension. Only when you click "Download" in settings does the extension fetch dictionary shards and store them on your device. During the download **only dictionary files are retrieved — nothing from your side is uploaded (no captions, no looked-up words)**. See Sections 3 and 11.

### 2. How We Use Information
- Solely to provide the core functionality (full-line captions, hover translation, whole-line translation).
- Not used for advertising, profiling, analytics, or sale.

### 3. Third-Party Services
Translated text is sent to the following third-party translation services (chosen automatically by availability):
- **Google Translate** (translate.googleapis.com / translate.google.com) — default engine;
- **Bing Translator** (www.bing.com) — optional, or fallback when Google is unavailable;
- **MyMemory** (api.mymemory.translated.net) — last-resort fallback when the first two are unreachable.

**English phonetics**: provided by an **offline dictionary bundled with the extension** (derived from CMUdict). Lookups happen entirely on your device — **no network request, no data sent to any third party**.

**Download sources for the optional offline dictionaries** (contacted only when you start a download, and only to download):
- **jsDelivr CDN** (cdn.jsdelivr.net) — the default location hosting this project's `dict-v1` dictionary package;
- **GitHub Raw** (raw.githubusercontent.com) — fallback when the CDN is unreachable;
- You may also enter **your own mirror URL** in settings, in which case only that address is contacted.

After a dictionary is installed, word lookups happen **entirely on your device** (extension-origin IndexedDB). Looked-up words and caption text are **never** sent to any of the parties above, nor to any translation service.

These third parties handle the text according to their own privacy policies.

**Receiving and forwarding user feedback** (only when you voluntarily submit it):
- **Cloudflare Workers / D1** — receives and stores the feedback content (server-side database);
- **Feishu (Lark)** — delivers the feedback to the developer as a chat message.

### 4. Data Storage & Retention
- Settings and translation cache are stored only in the browser locally (chrome.storage.local); no server is operated.
- We keep no copy of translated text.
- Clearing browser data removes all local cache.
- User feedback you voluntarily submit (including optional diagnostics) is stored in a server-side database for up to **180 days** and then deleted automatically; the **irreversible IP hash** used for abuse prevention is deleted together with the record.

### 5. Security
- All network requests use HTTPS.
- No account system; no login credentials involved.

### 6. Children's Privacy
- This extension does not target children under 13 and collects no personal information.

### 7. Your Rights
- You can turn off translation at any time in the extension settings.
- You can clear local browser data at any time.
- If you submitted feedback and want it deleted, contact us via Section 9 and we will remove the record.

### 8. Changes to This Policy
- Updates will be published on the PRIVACY.md page of the public repository.

### 11. Optional Offline Dictionaries (download and local storage)
- **Not downloaded by default**: no dictionary data is bundled, and nothing is downloaded automatically. Without a download the feature is inactive.
- **What you get**: three open-source dictionaries (ECDICT English–Chinese, 401,606 entries / WordNet 3.1 English–English, 82,810 entries / CC-CEDICT Chinese–English, 198,553 entries), each downloadable or removable individually in settings.
- **Where and how much**: stored in your device's extension-origin IndexedDB (database `kt-dict`); all three together are about 18 MB. Removing the extension or clicking "Remove" deletes them.
- **No upload**: a download only issues GET requests for dictionary files. No telemetry, no download reporting, and no looked-up words are transmitted.
- **Licensing**: all three are open-source (MIT / WordNet License / CC BY-SA 4.0); attribution and full license texts ship with the extension, see `THIRD_PARTY_NOTICES.md` and `src/data/*-LICENSE.txt`.

### 9. Contact
- https://github.com/weijianluo114-ux/subtitle-translator/issues

### 10. User Feedback (voluntary)
- You may submit a bug report or suggestion via "Feedback" in the extension. It is **entirely voluntary and anonymous**: no login is required, and we do not collect your name, email, account, or any identity data.
- What is sent: the category and message you typed; if you **opt in** to "Attach diagnostics", it additionally includes the extension version, browser version, current video URL, and the last 20 debug log entries.
- We also record an **irreversible IP hash** (used solely for rate limiting / abuse prevention; it cannot be converted back to your IP address). It is deleted together with the feedback record after 180 days.
- Feedback is used only to fix issues and improve the extension; never for advertising, profiling, or sale.
- Processors: Cloudflare (storage & forwarding), Feishu/Lark (notification).
