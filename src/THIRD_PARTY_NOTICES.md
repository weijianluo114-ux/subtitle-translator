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

## 图标

`src/icons/*.png` 为本项目生成的原创简易图标，可自由替换。

## 数据流向声明（与商店隐私声明一致）

- 无悬停翻译操作时：插件不产生任何对外网络请求（仅读取 YouTube 页面自身的字幕请求响应）。
- 悬停翻译 / 整句翻译时：仅把被翻译文本与语言代码发送给所选引擎（Google：translate.googleapis.com；Bing：www.bing.com）。
- 设置与翻译缓存仅保存在本机 chrome.storage.local，不收集、不上传任何用户数据。
