# Subtitle Line Translator (subtitle-translator)

> Language: [中文](README.md) | **English**

A lightweight Chrome extension that turns YouTube subtitles into readable **full-line captions**, and lets you **hover any word to translate it instantly** (plus the whole current line), with the video auto-paused while you read.

**Status**: v0.1.17. Source code lives in `src/` (load unpacked to test).

## Features

- **Full-line captions**: auto captions grouped into sentences/phrases (1–3 lines configurable); manual captions can be rechunked or kept as written; lyric protection, live-broadcast fragment repair, long-pause auto-hide;
- **Hover translation**: instant word/phrase translation, 130+ languages, auto source detection, per-word translation for Chinese/Japanese/Thai and other space-less languages;
- **Shift-drag multi-select**: hold Shift and drag across words to translate a phrase;
- **Translation master switch**: turn it off to keep only the line-caption display, with zero hover interaction;
- **Auto-pause while translating**; your own manual pause is never overridden;
- **Whole-line translation** shown together with the hovered word's translation (current line only, cached);
- **Engine fallback chain**: Google (default) → Bing → MyMemory, so translation works even on restricted networks;
- **Customizable appearance**: 21-grid position presets + custom position sliders, caption width slider, 6 bundled fonts, size/color/background/outline/bold; fully customizable tooltip style (font/size/bold/color/background opacity/edge);
- **Local cache**, no ads, no personal data collection.

## Directory structure

| Path | Description |
| --- | --- |
| `src/` | **Extension source (load this folder unpacked)** |
| `tests/` | Core-algorithm regression tests (Node) |
| `tools/make_icons.py` | Icon generator script |
| `build.py` | Packaging script → `dist/*.zip` (for store upload) |
| `LICENSE` | MIT license |

> `_reference/` (snapshots of the two reference repos) and `dist/` (build artifacts) are not committed, see `.gitignore`.

## Try it now

1. Open Chrome → `chrome://extensions` → enable **Developer mode** (top right).
2. Click **Load unpacked** and select the **`src`** folder of this repo.
3. Open any YouTube video with captions (auto captions are fine):
   - Subtitles are shown as **full lines** (≤2 lines by default);
   - **Hover a subtitle word**: the video auto-pauses and a tooltip shows the word's translation + transliteration/dictionary + **the current whole line's translation**, with the hovered word glowing/bold/enlarged;
   - Move away → the video resumes;
   - Hold **Shift** and drag to select a phrase for translation; **left-click** a word to copy its translation (configurable);
   - Click the toolbar icon to open settings (two tabs: Settings / Appearance).

## Dev checks

```bash
# JS syntax check
node --check src/inject.js && node --check src/background.js && node --check src/storage-bridge.js && node --check src/popup.js
# Core algorithm regression tests
node tests/kt-core-test.mjs src/inject.js
# Build the store zip
python3 build.py
```

## License

MIT — see [LICENSE](LICENSE). Bundled fonts are OFL-licensed; `languages.json` comes from the MIT-licensed hover-translate repo; see `src/THIRD_PARTY_NOTICES.md`. The code is an independent implementation that only takes algorithmic inspiration from hover-translate (MIT) and ketuvia (AGPL-3.0).

## ☕ Support me / Buy me a coffee (for school fee)

Scan to buy me a coffee — it supports my school fees:

| WeChat Pay | Alipay |
| --- | --- |
| ![WeChat Pay QR](src/assets/wechat.png) | ![Alipay QR](src/assets/alipay.jpg) |
