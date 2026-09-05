# 字幕悬停翻译插件（subtitle-translator）

> 目标：一个精简的 Chrome 插件，融合两个开源项目的能力 ——
> 1. **悬停字幕翻译 + 翻译时自动暂停视频**（参考 [hover-translate](https://github.com/kozii-d/hover-translate)）
> 2. **字幕整行 / 整句显示**（参考 [ketuvia](https://github.com/intercalaris/ketuvia)）

**当前状态：需求已确认（见 docs/09-最终决策与变更记录.md），插件源码已生成于 `src/`，可直接加载测试。**

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `docs/` | 全部详细文档（Markdown），所有细分功能均带勾选框 |
| `src/` | **插件源码（Load unpacked 选这个目录）** |
| `tests/` | 核心算法回归测试（Node） |
| `build.py` | 打包脚本 → `dist/*.zip`（商店上传用） |
| `LICENSE` | MIT 开源许可 |

> `_reference/`（两个参考仓库源码快照）与 `dist/`（构建产物）不入库，见 `.gitignore`。

## 立即安装试用

1. 打开 Chrome → `chrome://extensions` → 右上角开启「开发者模式」。
2. 点「加载已解压的扩展程序」，选择本目录下的 **`src`** 文件夹。
3. 打开任意 YouTube 视频并开启字幕（自动字幕即可）：
   - 字幕会按**整行/整句**显示（默认 2 行内）；
   - **鼠标悬停字幕上的单词**：视频自动暂停，气泡显示该词翻译 + 音译/词典释义 + **当前整行译文**；
   - 被选中的词**高亮加粗放大**；
   - 移开鼠标 → 视频继续播放；
   - 按住 **Shift** 可连续悬停多词翻译短语；**左键单击**单词复制译文（可改）；
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

## 更新 PRD 时的新增功能（v2）

- 字幕位置自定义滑块（水平/垂直）、字幕宽度自定义滑块（见弹窗「外观」页）。
- 整句翻译联动：悬停词时显示当前整行译文（见弹窗「设置」页开关）。

## 许可

本项目以 [MIT License](LICENSE) 开源。内置字体为 OFL 许可、`languages.json` 来自 MIT 许可的 hover-translate 仓库，详见 `src/THIRD_PARTY_NOTICES.md`。代码为独立实现，仅参考 hover-translate（MIT）与 ketuvia（AGPL-3.0）的算法思路。

