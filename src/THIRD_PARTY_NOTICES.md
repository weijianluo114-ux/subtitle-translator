# 第三方内容与许可声明

本插件（subtitle-translator）的代码为独立实现，参考了以下开源项目的思路：

| 项目 | 仓库 | 许可 | 使用方式 |
| --- | --- | --- | --- |
| hover-translate | https://github.com/kozii-d/hover-translate | MIT | 参考悬停翻译/自动暂停/分词/翻译引擎思路；`languages.json` 语言表取自该仓库（MIT 数据文件） |
| ketuvia | https://github.com/intercalaris/ketuvia | AGPL-3.0 | 仅参考字幕拦截/分块/覆盖层算法思路，**未复制其代码**，本插件独立实现 |

## 内置字体（均 OFL 许可，可随插件分发，须保留各自 OFL.txt）

| 字体 | 目录 | 许可文件 |
| --- | --- | --- |
| Atkinson Hyperlegible | src/fonts/Atkinson_Hyperlegible/ | OFL.txt |
| Cascadia Code | src/fonts/Cascadia_Code/ | OFL.txt |
| Noto Sans | src/fonts/Noto_Sans/ | OFL.txt |
| Average Sans | src/fonts/Average_Sans/ | OFL.txt |
| Roboto | src/fonts/Roboto/ | OFL.txt |
| Bona Nova | src/fonts/Bona_Nova/ | OFL.txt |

## 内置离线音标词典（英文）

`src/data/ipa-en.tsv` 由 **CMUdict** 转换而来，用于在翻译气泡中显示英文单词的美式 IPA 音标。
该文件完全内置于扩展，**纯本地查表：不联网、不发送任何数据**。

- 来源：https://github.com/cmusphinx/cmudict （许可：BSD-2-Clause）
- 生成脚本：`tools/make_ipa_dict.py`（ARPAbet → IPA 的确定性转换，可复现；含常用读音优先表）
- 许可全文：`src/data/CMUDICT-LICENSE.txt`（BSD-2-Clause 要求随分发保留版权声明与免责声明，故完整保留于扩展包内）
- 规模：125,909 个词条 / 134,996 个读音


## 可选离线词典（用户主动下载，默认不随扩展分发）

扩展本体**不包含**以下词典数据，只有当用户在设置里点击「下载」时才会从 CDN 取回分片，
存进本机扩展源 IndexedDB（`kt-dict`），随时可在界面里删除。
词典仅用于把单词释义显示在翻译气泡里，**纯本地查表，不上传任何内容**。

| 词典 | 角色 | 词条 | 许可 | 来源 | 许可全文 |
| --- | --- | --- | --- | --- | --- |
| ECDICT | 主选（英汉） | 401,606 | MIT | https://github.com/skywind3000/ECDICT | `src/data/ECDICT-LICENSE.txt` |
| WordNet 3.1 | 备用（英英） | 82,810 | WordNet License | https://wordnet.princeton.edu/ | `src/data/WORDNET-LICENSE.txt` |
| CC-CEDICT | 备用（汉英） | 198,553 | CC BY-SA 4.0 | https://www.mdbg.net/chinese/dictionary?page=cc-cedict | `src/data/CC-BY-SA-4.0.txt` |

- 生成脚本：`tools/build_dicts.py`（可复现：把上游原始数据按统一格式切分成 32 个 hash 分片并 gzip）
- 清单与校验：`src/data/dict-catalog.json` 记录每个分片的条目数、字节数与 **sha256**；下载后逐片校验，不匹配即丢弃
- 托管地址：仓库 orphan 分支 `dict-v1`（`cdn.jsdelivr.net/gh/weijianluo114-ux/subtitle-translator@dict-v1/dicts`，失败回退 `raw.githubusercontent.com`）
- **CC BY-SA 4.0 义务**：CC-CEDICT 是「改编后分发」的词典数据，我们保留了原作者署名（MDBG / CC-CEDICT 社区）、许可链接与许可全文，且该数据分片本身同样以 CC BY-SA 4.0 提供

## 图标

`src/icons/*.png` 为本项目生成的原创简易图标，可自由替换。

## 数据流向声明（与商店隐私声明一致）

- 无悬停翻译操作时：插件不产生任何对外网络请求（仅读取 YouTube 页面自身的字幕请求响应）。
- 悬停翻译 / 整句翻译时：仅把被翻译文本与语言代码发送给所选引擎（Google：translate.googleapis.com；Bing：www.bing.com；MyMemory：api.mymemory.translated.net；DeepL：api-free.deepl.com，仅在你自填 Key 时；自定义端点：仅在你自填 URL 时）。

## 可选第三方翻译引擎

| 引擎 | 是否免配置 | 说明 |
| --- | --- | --- |
| Google Translate | 是（默认） | 网页翻译接口，无需注册 |
| Bing Translator | 是 | 需要先从 www.bing.com/translator 抓取动态参数 |
| MyMemory | 是 | 匿名免费额度约几千字符/天，额度耗尽后自动熔断 1 小时 |
| DeepL | **否**，需自填 API Key | 免费额度 50 万字符/月；Free Key 以 `:fx` 结尾，走 api-free.deepl.com。Key 仅存本机 |
| 自定义端点 | **否**，需自填 URL | 由用户自行部署（如 Cloudflare Worker）；扩展只向其 POST JSON |

**API Key 处理原则**：DeepL 的 Key 只保存在 `chrome.storage.local`，不上传、不进日志、不进诊断报告；扩展不代理、不转发、不缓存该 Key。
- 英文音标：使用**内置于扩展的离线词典**（`src/data/ipa-en.tsv`，由 CMUdict 转换），纯本地查表，不联网、不发送任何数据。
- 可选离线词典：仅在你点击「下载」时才请求 `cdn.jsdelivr.net`（或你自填的镜像）取词典分片；下载完成后查词不再产生任何网络请求。整个过程不发送你的任何字幕内容。
- 设置与翻译缓存仅保存在本机 chrome.storage.local，不收集、不上传任何用户数据。
