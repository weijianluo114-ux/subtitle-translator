# 字幕悬停翻译插件（subtitle-translator）

> Language: **中文** | [English](README.en.md)

一个精简的 Chrome 扩展：让 YouTube 字幕**整行/整句显示**，并支持**悬停字幕单词即时翻译**（含当前整行译文），翻译时视频自动暂停。

**当前状态**：v0.1.17，源码在 `src/`，可直接加载测试。

## 功能一览

- **整行字幕**：自动字幕按句子/短语显示（1~3 行可调）；手动字幕可重排或原样保留；歌词排版保护、直播字幕碎片拼接、长停顿自动清屏；
- **悬停翻译**：单词/短语即时翻译，支持 130+ 语言、源语言自动检测，中日泰等无空格语言逐词翻译；
- **Shift 拖选多词**：按住 Shift 拖动鼠标扫过字幕，即可选中多个词翻译短语；
- **翻译总开关**：关闭后仅保留整行字幕显示，悬停不触发任何操作；
- **翻译时自动暂停视频**，手动暂停不会被误恢复；
- **整句翻译**：悬停时同框显示该词翻译 + 当前整行字幕译文（只翻译当前行、即翻即缓存）；
- **引擎自动兜底**：Google（默认）→ Bing → MyMemory，国内网络环境也能翻译；
- **外观可定制**：21 宫格位置 + 自定义位置滑块、字幕宽度滑块、6 种内置字体、字号/颜色/背景/描边/加粗；翻译气泡样式也可自定义（字体/字号/加粗/颜色/背景透明度/字符边缘）；
- **本地缓存**、无广告、不收集个人信息。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `src/` | **插件源码（Load unpacked 选这个目录）** |
| `tests/` | 核心算法回归测试（Node） |
| `tools/make_icons.py` | 图标生成脚本 |
| `build.py` | 打包脚本 → `dist/*.zip`（商店上传用） |
| `LICENSE` | MIT 开源许可 |

> `_reference/`（两个参考仓库源码快照）与 `dist/`（构建产物）不入库，见 `.gitignore`。

## 立即安装试用

1. 打开 Chrome → `chrome://extensions` → 右上角开启「开发者模式」。
2. 点「加载已解压的扩展程序」，选择本目录下的 **`src`** 文件夹。
3. 打开任意 YouTube 视频并开启字幕（自动字幕即可）：
   - 字幕会按**整行/整句**显示（默认 2 行内）；
   - **鼠标悬停字幕单词**：视频自动暂停，气泡显示该词翻译 + 音译/词典释义 + **当前整行译文**，选中词发光加粗放大；
   - 移开鼠标 → 视频继续播放；
   - 按住 **Shift** 拖动可多选翻译短语；**左键单击**单词复制译文（可改）；
   - 点工具栏图标打开设置（「设置」「外观」两个标签页）。

## 开发自检

```bash
# JS 语法检查
node --check src/inject.js && node --check src/background.js && node --check src/storage-bridge.js && node --check src/popup.js
# 核心算法回归测试
node tests/kt-core-test.mjs src/inject.js
# 打包
python3 build.py
```

## 许可

本项目以 [MIT License](LICENSE) 开源。内置字体为 OFL 许可、`languages.json` 来自 MIT 许可的 hover-translate 仓库，详见 `src/THIRD_PARTY_NOTICES.md`。代码为独立实现，仅参考 hover-translate（MIT）与 ketuvia（AGPL-3.0）的算法思路。

## ☕ 支持我 / Buy me a coffee (for school fee)

扫码请我喝杯咖啡，支持学费：

| 微信 WeChat | 支付宝 Alipay |
| --- | --- |
| ![WeChat Pay QR](src/assets/wechat.png) | ![Alipay QR](src/assets/alipay.jpg) |
