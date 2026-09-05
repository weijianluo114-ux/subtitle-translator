/* ============================================================================
 * inject.js —— MAIN world content script（整行字幕 + 悬停翻译 + 暂停）
 *
 * 运行在页面主世界：只有这样才能拦截 YouTube 自己的 fetch/XHR 字幕请求。
 * 无法使用 chrome.* API，因此：
 *   - 设置由 storage-bridge.js（ISOLATED）经 documentElement.dataset + 事件传入
 *   - 翻译缓存经 'kt-cache-save' 事件交给 bridge 写 storage.local
 *   - Bing 翻译经 'kt-bing-request/response/abort' 事件由 bridge 转后台
 *
 * 功能链路：
 *   拦截 timedtext(fmt=json3) → 解析词元 → 分块成整行 → 覆盖层逐词渲染
 *   → 悬停词/整行翻译 + 视频暂停 → 左键复制译文
 * ========================================================================== */

(() => {
  'use strict';
  if (window.__ktLoaded) return;
  window.__ktLoaded = true;

  /* ============================ 常量 ============================ */

  const CFG = {
    hoverDelayMs: 200,
    dragThresholdPx: 5,
    pollMs: 100,
    lookaheadMs: 300,
    minDurMs: 1800,
    maxDurMs: 5200,
    hardPauseMs: 5000,
    longPauseThresholdMs: 6000,
    longPauseHoldMs: 5500,
    maxWords: 40,
    minPunctuationLastLineFill: 0.45,
    wrapSafety: 0.985,
    rebuildYieldMs: 50,
    navRetryMs: 250,
    navRetryForMs: 8000,
    triggerRetryMs: 900,
    maxTriggerAttempts: 8,
    slowRetryMs: 3000,
    giveUpAfterMs: 40000,
    maxCaptionsToggles: 2,
    toggleAfterAttempts: 2,
    resizeDebounceMs: 120,
    resizeRebuildMs: 400,
    layoutSettleMs: 400,
    wordCacheMax: 3000,
    lineCacheMax: 1200,
    cacheWriteDelayMs: 5000,
    maxTranslateChars: 500,
    textWidthEm: 24,
    shortsWidthReductionEm: 3,
    normalWideReductionEm: 5,
    playerPaddingPx: 32,
    lineHeight: 1.4,
    tooltipMargin: 10,
    tooltipGap: 6,
    notificationMs: 2000,
    widthBuckets: { medium: 700, large: 1250, xwide: 1800, ultra: 2600 },
    fontSizePx: {
      small:   { small: 16, medium: 18, large: 20, xwide: 22, ultra: 26 },
      medium:  { small: 20, medium: 24, large: 28, xwide: 32, ultra: 40 },
      large:   { small: 24, medium: 30, large: 34, xwide: 40, ultra: 50 },
      xlarge:  { small: 30, medium: 38, large: 46, xwide: 58, ultra: 78 },
      xxlarge: { small: 36, medium: 46, large: 60, xwide: 76, ultra: 120 },
    },
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    manualCaptions: 'rechunk',
    targetLines: 2,
    textSize: 'medium',
    font: 'atkinson',
    positionMode: 'preset',
    position: 'center-low',
    posX: 50,
    posY: 70,
    textColor: 'white',
    textOpacity: 100,
    captionWidth: 'auto',
    widthPercent: 50,
    allCaps: false,
    textOutline: false,
    textBold: false,
    background: 50,
    translator: 'google',
    sourceLanguage: 'auto',
    targetLanguage: 'zh-CN',
    autoPause: true,
    leftClickAction: 'copy-translation',
    alwaysMultipleSelection: false,
    showNotifications: true,
    sentenceTranslation: true,
    tooltipFollowSubtitle: true,
    tooltip: {
      fontFamily: 'auto',
      fontSize: 'auto',
      fontColor: 'auto',
      fontOpacity: 'auto',
      backgroundColor: 'auto',
      backgroundOpacity: 'auto',
      characterEdgeStyle: 'auto',
    },
    uiLang: 'zh_CN',
    debug: false,
  };

  const STR = {
    zh_CN: {
      translationFailed: '翻译失败',
      copyFailed: '复制失败',
      copiedTranslation: '已复制译文',
      copiedOriginal: '已复制原文',
      lineLabel: '整句翻译',
      loading: '翻译中…',
      captionsFailed: '字幕加载失败',
    },
    en: {
      translationFailed: 'Translation failed',
      copyFailed: 'Copy failed',
      copiedTranslation: 'Translation copied',
      copiedOriginal: 'Original copied',
      lineLabel: 'Whole line',
      loading: 'Translating…',
      captionsFailed: 'Failed to load captions',
    },
  };
  const t = (key) => (STR[STATE_SETTINGS().uiLang] || STR.en)[key] || key;

  const FONT_FAMILIES = {
    atkinson: '"Atkinson Hyperlegible", system-ui, sans-serif',
    cascadia: '"Cascadia Code", ui-monospace, monospace',
    noto: '"Noto Sans", system-ui, sans-serif',
    average: '"Average Sans", system-ui, sans-serif',
    roboto: '"Roboto", system-ui, sans-serif',
    bona: '"Bona Nova", Georgia, serif',
  };
  const FONT_LOAD_FAMILIES = {
    atkinson: '"Atkinson Hyperlegible"',
    cascadia: '"Cascadia Code"',
    noto: '"Noto Sans"',
    average: '"Average Sans"',
    roboto: '"Roboto"',
    bona: '"Bona Nova"',
  };
  const TEXT_COLORS = { white: '#ffffff', yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff' };
  const CAPTION_WIDTHS = { auto: 0, third: 1 / 3, half: 0.5, twothirds: 2 / 3 };
  const PRESET_POSITIONS = {
    'left-top': { x: 'left', y: 8 }, 'center-top': { x: 'center', y: 8 }, 'right-top': { x: 'right', y: 8 },
    'left-high': { x: 'left', y: 18 }, 'center-high': { x: 'center', y: 18 }, 'right-high': { x: 'right', y: 18 },
    'left-highish': { x: 'left', y: 30 }, 'center-highish': { x: 'center', y: 30 }, 'right-highish': { x: 'right', y: 30 },
    'left-middle': { x: 'left', y: 50 }, 'center-middle': { x: 'center', y: 50 }, 'right-middle': { x: 'right', y: 50 },
    'left-lowish': { x: 'left', y: 70 }, 'center-lowish': { x: 'center', y: 70 }, 'right-lowish': { x: 'right', y: 70 },
    'left-low': { x: 'left', y: 82 }, 'center-low': { x: 'center', y: 82 }, 'right-low': { x: 'right', y: 82 },
    'left-bottom': { x: 'left', y: 92 }, 'center-bottom': { x: 'center', y: 92 }, 'right-bottom': { x: 'right', y: 92 },
  };
  const SHORTS_Y_REMAP = { 8: 18, 18: 30, 30: 40, 50: 50, 70: 60, 82: 70, 92: 82 };

  /* 工具按宽度切行的证据：行尾落在这些虚词上 */
  const PHRASE_GLUE = new Set((
    'a an the this that these those my your his her its our their ' +
    'of to in on at by for with from into onto upon over under about across through during ' +
    'and or but nor so yet as if than then because while when where whether which who whom whose ' +
    'is are was were am be been being do does did have has had ' +
    'will would shall should can could may might must ' +
    'no not any some each every either neither both all ' +
    'i you he she it we they there here what how why'
  ).split(/\s+/));

  /* ============================ 设置 ============================ */

  function normalizeSettings(raw) {
    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const src = raw && typeof raw === 'object' ? raw : {};
    const bool = (v) => (typeof v === 'boolean' ? v : null);
    const num = (v, min, max) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
    };
    const pick = (key, allowed, coerce) => {
      const c = coerce ? coerce(src[key]) : null;
      if (c != null) { s[key] = c; return; }
      if (allowed && allowed.includes(src[key])) s[key] = src[key];
    };
    pick('enabled', null, bool);
    pick('manualCaptions', ['rechunk', 'keep']);
    pick('targetLines', null, (v) => ([1, 2, 3].includes(Number(v)) ? Number(v) : null));
    pick('textSize', ['small', 'medium', 'large', 'xlarge', 'xxlarge']);
    pick('font', ['atkinson', 'cascadia', 'noto', 'average', 'roboto', 'bona']);
    pick('positionMode', ['preset', 'custom']);
    pick('position', Object.keys(PRESET_POSITIONS));
    pick('posX', null, (v) => num(v, 0, 100));
    pick('posY', null, (v) => num(v, 0, 100));
    pick('textColor', ['white', 'yellow', 'green', 'cyan']);
    pick('textOpacity', null, (v) => ([100, 75, 50].includes(Number(v)) ? Number(v) : null));
    pick('captionWidth', ['auto', 'third', 'half', 'twothirds', 'custom']);
    pick('widthPercent', null, (v) => num(v, 10, 100));
    pick('allCaps', null, bool);
    pick('textOutline', null, bool);
    pick('textBold', null, bool);
    pick('background', null, (v) => ([0, 25, 50, 75, 100].includes(Number(v)) ? Number(v) : null));
    pick('translator', ['google', 'bing']);
    pick('sourceLanguage', null, (v) => (typeof v === 'string' && v ? v : null));
    pick('targetLanguage', null, (v) => (typeof v === 'string' && v ? v : null));
    pick('autoPause', null, bool);
    pick('leftClickAction', ['copy-translation', 'copy-original', 'nothing']);
    pick('alwaysMultipleSelection', null, bool);
    pick('showNotifications', null, bool);
    pick('sentenceTranslation', null, bool);
    pick('tooltipFollowSubtitle', null, bool);
    if (src.tooltip && typeof src.tooltip === 'object') {
      for (const k of Object.keys(s.tooltip)) {
        if (typeof src.tooltip[k] === 'string') s.tooltip[k] = src.tooltip[k];
      }
    }
    if (src.uiLang === 'en' || src.uiLang === 'zh_CN') s.uiLang = src.uiLang;
    pick('debug', null, bool);
    return s;
  }

  /* ============================ 状态 ============================ */

  const STATE = {
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    videoId: null,
    asrLang: null,
    words: [],
    chunks: [],
    overlay: null,
    overlayText: null,
    measurer: null,
    measurerText: null,
    layout: null,
    pollId: null,
    lastText: null,
    activeChunkText: '',
    activeChunkRaw: '',
    statusMode: 'idle',
    triggered: false,
    navRetryId: null,
    navRetryUntil: 0,
    triggerRetryId: null,
    triggerAttempts: 0,
    firstTriggerAtMs: 0,
    captionsToggles: 0,
    captionsWatcher: null,
    resizeObserver: null,
    resizeObservedPlayer: null,
    resizeObservedVideo: null,
    resizeTimerId: null,
    resizeLayoutTimerId: null,
    layoutSettleTimerId: null,
    lastResizeW: -1,
    lastResizeH: -1,
    measureRange: null,
    fontLoadRequestId: 0,
    chunkBuildRequestId: 0,
    chunkBuildSignature: null,
    chunkBuildInFlightSignature: null,
    timedtextRequestCount: 0,
    timedtextResponseCount: 0,
    lastTimedtextResponse: null,
    lastCaptionTracks: null,
    /* 翻译 */
    hoverTimer: null,
    hoverGen: 0,
    abortController: null,
    activeTranslation: null,
    activeLine: null,
    selectedWords: new Set(),
    firstSel: null,
    lastSel: null,
    activeWord: null,
    tooltip: null,
    notification: null,
    wordCache: new Map(),
    lineCache: new Map(),
    cacheDirty: { word: false, line: false },
    cacheTimer: null,
    dragState: null,
    debugLogs: [],
  };
  window.__ktState = STATE;

  function STATE_SETTINGS() { return STATE.settings; }

  function log(...args) {
    if (STATE.settings.debug) console.log('[KT]', ...args);
  }
  function warn(...args) {
    if (STATE.settings.debug) console.warn('[KT]', ...args);
  }
  function debugLog(type, detail) {
    if (!STATE.settings.debug) return;
    STATE.debugLogs.push({ at: Date.now(), type, detail });
    if (STATE.debugLogs.length > 500) STATE.debugLogs.splice(0, STATE.debugLogs.length - 500);
  }
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  /* ============================ 设置桥 ============================ */

  function applySettings(next) {
    const prev = STATE.settings;
    STATE.settings = normalizeSettings(next);
    window.__ktSettings = { ...STATE.settings };

    const rebuildKeys = ['targetLines', 'textSize', 'font', 'allCaps', 'textBold', 'captionWidth', 'widthPercent'];
    const needsRebuild = rebuildKeys.some((k) => prev[k] !== STATE.settings[k]);

    // Manual CC 策略变化 → 用已存字幕数据重新解析
    if (prev.manualCaptions !== STATE.settings.manualCaptions) {
      const raw = window.__ktLastTimedtext;
      if (raw && raw.videoId === STATE.videoId) {
        processTimedtext(raw.text);
        return;
      }
    }

    if (!STATE.settings.enabled) {
      stopPolling();
      clearOverlay();
      return;
    }
    if (areNativeCaptionsEnabled() === false) {
      stopPolling();
      clearOverlay();
      watchCaptionsButton();
      return;
    }

    const fontChanged = prev.font !== STATE.settings.font || prev.textBold !== STATE.settings.textBold;
    if (needsRebuild && fontChanged) {
      rebuildAfterFontReady();
    } else if (needsRebuild) {
      rebuildChunksForLayout('settings_changed', true);
    } else {
      mountOverlay();
      if (STATE.layout) {
        applyLayout(STATE.overlay, STATE.layout);
        applyLayout(STATE.measurer, STATE.layout);
      }
      if (STATE.chunks.length) startPolling();
      renderCurrentCaption(true);
    }
  }

  document.documentElement.addEventListener('kt-settings-sync', (e) => {
    try { applySettings(e.detail); } catch (err) { /* 忽略坏设置 */ }
  });

  function bootSettings() {
    const raw = document.documentElement.dataset.ktSettings;
    if (raw) {
      try { applySettings(JSON.parse(raw)); } catch (err) { /* 忽略 */ }
    }
  }

  /* ============================ 翻译引擎 ============================
   * 翻译统一走"桥接 → 后台 service worker"代理：
   *   - MAIN world 页面代码受 YouTube 页面 CSP 约束，直连翻译接口可能被拦；
   *   - 后台具备 host_permissions（translate.googleapis.com / bing.com），无 CORS/CSP 限制；
   *   - 请求与响应经 documentElement 自定义事件进出页面（与设置桥同一通道）。
   */

  function requestTranslationViaBridge(translatorKey, text, sl, tl, signal) {
    return new Promise((resolve, reject) => {
      const id = 't' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        document.documentElement.removeEventListener('kt-translate-response', onResp);
        reject(new Error('translate-timeout'));
      }, 15000);
      const onResp = (e) => {
        if (!e.detail || e.detail.id !== id) return;
        settled = true;
        clearTimeout(timer);
        document.documentElement.removeEventListener('kt-translate-response', onResp);
        resolve(e.detail);
      };
      document.documentElement.addEventListener('kt-translate-response', onResp);
      if (signal) {
        signal.addEventListener('abort', () => {
          document.documentElement.dispatchEvent(new CustomEvent('kt-translate-abort', { detail: { id } }));
        }, { once: true });
      }
      document.documentElement.dispatchEvent(new CustomEvent('kt-translate-request', {
        detail: { id, translatorKey, text, sl, tl },
      }));
    });
  }

  async function translateText(text, signal) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const limited = raw.length > CFG.maxTranslateChars ? raw.slice(0, CFG.maxTranslateChars) : raw;
    const translatorKey = STATE.settings.translator === 'bing' ? 'bing' : 'google';
    const r = await requestTranslationViaBridge(
      translatorKey,
      limited,
      STATE.settings.sourceLanguage,
      STATE.settings.targetLanguage,
      signal
    );
    if (!r || !r.ok) throw new Error((r && r.error) || 'translate-failed');
    return {
      translatedText: r.translatedText || '',
      detectedLanguageCode: r.detectedLanguageCode || '',
      dictionary: r.dictionary || '',
      transliteration: r.transliteration || '',
      transcription: r.transcription || '',
    };
  }

  /* ============================ 翻译缓存（词 + 整行两级 LRU） ============================ */

  function cacheKey(text) {
    const s = STATE.settings;
    return [s.translator, s.sourceLanguage, s.targetLanguage, String(text || '').trim()].join('|');
  }

  function cacheGet(map, text) {
    const key = cacheKey(text);
    if (!map.has(key)) return null;
    const v = map.get(key);
    map.delete(key);
    map.set(key, v);
    return v;
  }

  function cachePut(map, max, entry) {
    map.set(entry.key, entry);
    if (map.size > max) map.delete(map.keys().next().value);
  }

  function markCacheDirty(kind) {
    STATE.cacheDirty[kind] = true;
    if (STATE.cacheTimer) return;
    STATE.cacheTimer = setTimeout(flushCaches, CFG.cacheWriteDelayMs);
  }

  function flushCaches() {
    clearTimeout(STATE.cacheTimer);
    STATE.cacheTimer = null;
    if (STATE.cacheDirty.word) {
      document.documentElement.dispatchEvent(new CustomEvent('kt-cache-save', {
        detail: { kind: 'word', data: Array.from(STATE.wordCache.values()).slice(-2000) },
      }));
      STATE.cacheDirty.word = false;
    }
    if (STATE.cacheDirty.line) {
      document.documentElement.dispatchEvent(new CustomEvent('kt-cache-save', {
        detail: { kind: 'line', data: Array.from(STATE.lineCache.values()).slice(-2000) },
      }));
      STATE.cacheDirty.line = false;
    }
  }

  function loadCaches() {
    const putArray = (map, max, arr) => {
      if (!Array.isArray(arr)) return;
      for (const entry of arr) {
        if (entry && typeof entry.key === 'string' && entry.translatedText) cachePut(map, max, entry);
      }
    };
    try {
      const w = document.documentElement.dataset.ktCacheWord;
      if (w) putArray(STATE.wordCache, CFG.wordCacheMax, JSON.parse(w));
    } catch (e) { /* 忽略坏缓存 */ }
    try {
      const l = document.documentElement.dataset.ktCacheLine;
      if (l) putArray(STATE.lineCache, CFG.lineCacheMax, JSON.parse(l));
    } catch (e) { /* 忽略坏缓存 */ }
    document.documentElement.removeAttribute('data-kt-cache-word');
    document.documentElement.removeAttribute('data-kt-cache-line');
    delete document.documentElement.dataset.ktCacheWord;
    delete document.documentElement.dataset.ktCacheLine;
    log('cache loaded', STATE.wordCache.size, STATE.lineCache.size);
  }

  document.documentElement.addEventListener('kt-cache-init', loadCaches);
  window.addEventListener('pagehide', flushCaches);

  async function translateCached(kind, text, signal) {
    const map = kind === 'word' ? STATE.wordCache : STATE.lineCache;
    const max = kind === 'word' ? CFG.wordCacheMax : CFG.lineCacheMax;
    const hit = cacheGet(map, text);
    if (hit) return hit;
    const data = await translateText(text, signal);
    if (!data || !data.translatedText) return null;
    const entry = {
      key: cacheKey(text),
      originalText: String(text).trim(),
      translatedText: data.translatedText,
      detectedLanguageCode: data.detectedLanguageCode || '',
      dictionary: data.dictionary || '',
      transliteration: data.transliteration || '',
      transcription: data.transcription || '',
    };
    cachePut(map, max, entry);
    markCacheDirty(kind);
    return entry;
  }

  /* ============================ 分词（无空格语言支持） ============================ */

  const SPACELESS_SCRIPTS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Khmer}]/u;
  let cachedSegmenter;
  function getSegmenter() {
    if (cachedSegmenter !== undefined) return cachedSegmenter;
    cachedSegmenter = (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function')
      ? new Intl.Segmenter(undefined, { granularity: 'word' })
      : null;
    return cachedSegmenter;
  }

  function splitChunk(chunk, isLast) {
    const whole = [{ text: chunk, separator: ' ' }];
    if (!SPACELESS_SCRIPTS.test(chunk)) return whole;
    const segmenter = getSegmenter();
    if (!segmenter) return whole;
    const words = [];
    let pending = '';
    for (const seg of segmenter.segment(chunk)) {
      if (seg.isWordLike) {
        words.push({ text: pending + seg.segment, separator: '' });
        pending = '';
      } else {
        pending += seg.segment;
      }
    }
    if (!words.length) return whole;
    words[words.length - 1].separator = pending + (isLast ? '' : ' ');
    return words;
  }

  function splitIntoWords(text) {
    const chunks = String(text || '').split(/\s+/);
    const out = [];
    chunks.forEach((chunk, i) => {
      for (const w of splitChunk(chunk, i === chunks.length - 1)) out.push(w);
    });
    return out;
  }

  const renderWord = (w) => w.text + w.separator;

  /* ============================ 播放器与视频定位 ============================ */

  function getPlayerElement() {
    const players = Array.from(document.querySelectorAll('.html5-video-player'));
    const area = (el) => {
      const r = el.getBoundingClientRect();
      return r.width * r.height;
    };
    const onScreen = players.filter((el) => area(el) > 0);
    const pool = onScreen.length ? onScreen : players;
    const wanted = location.pathname.startsWith('/shorts/') ? 'shorts-player' : 'movie_player';
    return pool.find((el) => el.id === wanted)
      || pool.sort((a, b) => area(b) - area(a))[0]
      || document.querySelector('#movie_player')
      || null;
  }

  function findVideo() {
    const player = getPlayerElement();
    if (player) {
      const v = player.querySelector('video');
      if (v) return v;
    }
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function currentVideoId() {
    if (location.pathname.startsWith('/shorts/')) {
      return location.pathname.split('/shorts/')[1] ? location.pathname.split('/shorts/')[1].split('?')[0] : null;
    }
    if (location.pathname !== '/watch') return null;
    try { return new URL(location.href).searchParams.get('v'); } catch (e) { return null; }
  }

  /* ============================ 字幕数据拦截 ============================ */

  function rewriteTimedtextUrl(url) {
    try {
      const u = new URL(url);
      u.searchParams.set('fmt', 'json3');
      return u.toString();
    } catch (e) { return url; }
  }

  function onTimedtextBody(url, text) {
    if (!text || !text.length) return;
    let vid;
    try { vid = new URL(url).searchParams.get('v'); } catch (e) { return; }
    if (!vid) return;
    STATE.timedtextResponseCount += 1;

    // 防串台：预览/悬停缩略图播放器拉的字幕不是正在看的
    if (vid !== STATE.videoId && !location.pathname.startsWith('/shorts/')) {
      const onPage = currentVideoId();
      if (onPage && onPage !== vid) {
        debugLog('timedtext_other_video', { vid, onPage });
        return;
      }
    }

    window.__ktLastTimedtext = { videoId: vid, url, text, receivedAt: new Date().toISOString() };
    debugLog('timedtext_response', { vid, length: text.length });

    if (STATE.videoId && vid !== STATE.videoId) {
      resetForNewVideo();
      STATE.videoId = vid;
    }
    if (!STATE.videoId) STATE.videoId = vid;
    processTimedtext(text);
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
    if (url.includes('timedtext')) {
      const newUrl = rewriteTimedtextUrl(url);
      STATE.timedtextRequestCount += 1;
      debugLog('timedtext_request', { transport: 'fetch', url: newUrl });
      const req = typeof input === 'string' ? newUrl : new Request(newUrl, input);
      const p = origFetch.call(this, req, init);
      p.then((resp) => {
        resp.clone().text().then((t) => onTimedtextBody(newUrl, t)).catch(() => {});
      });
      return p;
    }
    return origFetch.apply(this, arguments);
  };

  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string' && url.includes('timedtext')) {
      const newUrl = rewriteTimedtextUrl(url);
      this._ktTimedtextUrl = newUrl;
      STATE.timedtextRequestCount += 1;
      debugLog('timedtext_request', { transport: 'xhr', url: newUrl });
      return origXhrOpen.call(this, method, newUrl, ...Array.prototype.slice.call(arguments, 2));
    }
    return origXhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this._ktTimedtextUrl) {
      this.addEventListener('load', () => {
        onTimedtextBody(this._ktTimedtextUrl, this.responseText);
      });
    }
    return origXhrSend.apply(this, arguments);
  };

  /* ============================ json3 解析与词元提取 ============================ */

  function getTextEventInfo(json3) {
    const events = json3.events || [];
    const textEvents = [];
    let newlineCount = 0;
    events.forEach((ev, i) => {
      const segs = ev.segs || [];
      if (!segs.length) return;
      const text = segs.map((s) => s.utf8 || '').join('');
      if (text === '\n') { newlineCount += 1; return; }
      textEvents.push({ index: i, ev, text });
    });
    const singleSeg = textEvents.filter((item) => (item.ev.segs || []).length === 1).length;
    const timedWindow = textEvents.filter((item) => Object.prototype.hasOwnProperty.call(item.ev, 'wWinId')).length;
    const manualLike =
      textEvents.length > 0 &&
      newlineCount === 0 &&
      timedWindow === 0 &&
      singleSeg / textEvents.length >= 0.9;
    return { events, textEvents, manualLike, newlineCount };
  }

  function deliveryCharsPerSecond(textEvents) {
    let chars = 0;
    let ms = 0;
    for (const item of textEvents) {
      const dur = Number(item.ev.dDurationMs);
      if (!Number.isFinite(dur) || dur <= 0) continue;
      ms += dur;
      chars += String(item.text || '').trim().length;
    }
    return ms > 0 ? chars / (ms / 1000) : null;
  }

  /* 判断手动字幕的断行是不是"创作者写的"：
   * - keep 模式：全部视为创作者写的
   * - 语速很慢（唱歌/朗诵）→ 创作者写的
   * - 断行位置大量落在虚词上 → 工具按宽度切的，可跨行合并 */
  function mayRechunkAcrossLines(info) {
    if (!info.manualLike) return true; // 自动字幕（逐词）没有创作者断行
    if (STATE.settings.manualCaptions === 'keep') return false;
    const rate = deliveryCharsPerSecond(info.textEvents);
    if (rate != null && rate < 12) return false;
    const ends = info.textEvents.map((item) => {
      const ws = String(item.text || '').trim().split(/\s+/);
      const last = ws[ws.length - 1] || '';
      return last.replace(/[^A-Za-z']/g, '').toLowerCase();
    });
    const breaks = ends.length;
    if (breaks < 40) return false;
    const glueEnds = ends.filter((w) => PHRASE_GLUE.has(w)).length;
    return glueEnds / breaks >= 0.15;
  }

  function extractWords(json3) {
    const info = getTextEventInfo(json3);
    const authored = !mayRechunkAcrossLines(info);
    const out = [];
    let lastStart = -1;
    let subLineCounter = 0;

    if (info.manualLike) {
      for (const ev of info.events) {
        if (!ev.segs) continue;
        const base = ev.tStartMs || 0;
        const evDur = ev.dDurationMs || 0;
        const evEnd = base + evDur;
        for (const s of ev.segs) {
          const text = s.utf8 || '';
          const subLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
          if (!subLines.length) continue;
          const totalChars = subLines.reduce((n, l) => n + l.length, 0) || 1;
          const evSpan = Math.max(0, evEnd - base);
          let subStart = base;
          for (let li = 0; li < subLines.length; li++) {
            const line = subLines[li];
            const subEnd = li === subLines.length - 1
              ? evEnd
              : subStart + Math.round((line.length / totalChars) * evSpan);
            const subDur = Math.max(0, subEnd - subStart);
            const ws = line.split(/\s+/).filter(Boolean);
            const syn = subLineCounter;
            for (let wi = 0; wi < ws.length; wi++) {
              const start = subStart + Math.round((wi / ws.length) * subDur);
              if (start <= lastStart) continue;
              out.push({ start, end: subEnd, text: ws[wi], eventIndex: syn, preserveBoundary: authored });
              lastStart = start;
            }
            subStart = subEnd;
          }
          subLineCounter += 1;
        }
      }
    } else {
      for (const [eventIndex, ev] of info.events.entries()) {
        if (!ev.segs) continue;
        const base = ev.tStartMs || 0;
        const evDur = ev.dDurationMs || 0;
        const evEnd = base + evDur;
        let prevSegText = null;
        let prevToken = -1;
        for (const [segIndex, s] of ev.segs.entries()) {
          const text = s.utf8;
          if (!text || text === '\n') continue;
          const start = base + (s.tOffsetMs || 0);
          // 直播/广播按字符流推送：不完整的碎片接回上一个词
          const continues = prevToken >= 0 && prevSegText !== null && !/^\s/.test(text) && !/\s$/.test(prevSegText);
          prevSegText = text;
          if (continues) {
            out[prevToken].text += text;
            if (start > lastStart) lastStart = start;
            continue;
          }
          if (!text.trim()) continue;
          if (start <= lastStart) continue;
          const segWords = text.trim().split(/\s+/).filter(Boolean);
          if (segWords.length > 1) {
            const nextSeg = ev.segs[segIndex + 1];
            const nextEvent = info.events[eventIndex + 1];
            const segEndMs = nextSeg
              ? base + (nextSeg.tOffsetMs || 0)
              : Math.min(evEnd || Infinity, (nextEvent && nextEvent.tStartMs) || evEnd || start);
            const segSpan = Math.max(0, segEndMs - start);
            for (let wi = 0; wi < segWords.length; wi++) {
              const wordStart = Math.max(lastStart + 1, start + Math.round((wi / segWords.length) * segSpan));
              out.push({ start: wordStart, end: null, text: segWords[wi], eventIndex, preserveBoundary: false });
              lastStart = wordStart;
            }
            prevToken = out.length - 1;
            continue;
          }
          out.push({ start, end: null, text: text.trim(), eventIndex, preserveBoundary: false });
          prevToken = out.length - 1;
          lastStart = start;
        }
      }
    }
    debugLog('extract', { sourceKind: info.manualLike ? 'manual' : 'word-timed', wordCount: out.length, authored });
    return out;
  }

  function processTimedtext(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) {
      warn('timedtext 不是 JSON:', e && e.message);
      setStatus('error');
      return;
    }
    const words = extractWords(data);
    if (!words.length) {
      warn('没有提取到字幕词元, events=' + ((data.events || []).length));
      setStatus('error');
      return;
    }
    STATE.words = words;
    STATE.chunkBuildSignature = null;
    STATE.chunkBuildInFlightSignature = null;
    clearTriggerRetry();

    if (!STATE.settings.enabled || areNativeCaptionsEnabled() === false) {
      debugLog('timedtext_stored', { reason: !STATE.settings.enabled ? 'kt_off' : 'cc_off', words: words.length });
      if (STATE.settings.enabled) watchCaptionsButton();
      clearOverlay();
      return;
    }
    mountOverlay();
    setStatus('active');
    startPolling();
    rebuildAfterFontReady();
  }

  /* ============================ 分块（整行字幕生产核心） ============================ */

  const applyTextCase = (text) =>
    (!STATE.settings.allCaps || !text) ? text : text.toLocaleUpperCase();

  const classifyBreakChar = (text) => {
    const last = String(text || '').trimEnd().slice(-1);
    return { terminal: /[.!?]/.test(last), clause: /[,;:]/.test(last) };
  };

  function widthBucket(playerWidth) {
    return playerWidth >= CFG.widthBuckets.ultra ? 'ultra'
      : playerWidth >= CFG.widthBuckets.xwide ? 'xwide'
      : playerWidth >= CFG.widthBuckets.large ? 'large'
      : playerWidth >= CFG.widthBuckets.medium ? 'medium'
      : 'small';
  }

  function getLayoutMetrics(player) {
    const playerWidth = Math.max(0, player ? player.clientWidth || 0 : 0);
    if (!playerWidth) return null;
    const s = STATE.settings;
    const bucket = widthBucket(playerWidth);
    const sizeRow = CFG.fontSizePx[s.textSize] || CFG.fontSizePx.medium;
    const fontSizePx = sizeRow[bucket];
    const isShorts = location.pathname.startsWith('/shorts/');
    let widthEm = CFG.textWidthEm;
    if (isShorts) widthEm -= CFG.shortsWidthReductionEm;
    else if (s.textSize === 'large') widthEm -= CFG.normalWideReductionEm - 1;
    else if (s.textSize === 'medium' || s.textSize === 'xlarge' || s.textSize === 'xxlarge') widthEm -= CFG.normalWideReductionEm;
    const widthFontPx = isShorts
      ? CFG.fontSizePx.small[bucket]
      : (s.textSize === 'large' ? CFG.fontSizePx.medium[bucket] : fontSizePx);
    const maxAvailable = Math.max(0, playerWidth - CFG.playerPaddingPx);
    let textWidthPx;
    if (s.captionWidth === 'custom') {
      textWidthPx = Math.min(Math.round(playerWidth * clamp(s.widthPercent, 10, 100) / 100), maxAvailable);
    } else {
      const frac = CAPTION_WIDTHS[s.captionWidth] || 0;
      textWidthPx = !isShorts && frac > 0
        ? Math.min(Math.round(playerWidth * frac), maxAvailable)
        : Math.min(Math.round(widthFontPx * widthEm), isShorts ? maxAvailable : Math.round(playerWidth * (2 / 3)), maxAvailable);
    }
    return { textWidthPx, fontSizePx, lineHeight: CFG.lineHeight, targetLines: s.targetLines };
  }

  function ensureMeasureRange() {
    if (!STATE.measureRange) STATE.measureRange = document.createRange();
    return STATE.measureRange;
  }

  function measureNodeLayout(node, containerWidthPx, targetLines) {
    if (!node) return { lineCount: 1, lastLineFill: 1 };
    const range = ensureMeasureRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    const lines = [];
    for (const r of rects) {
      let line = lines.find((l) => Math.abs(l.top - r.top) < 2);
      if (!line) {
        line = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
        lines.push(line);
        continue;
      }
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.width = line.right - line.left;
    }
    lines.sort((a, b) => a.top - b.top);
    const lineCount = lines.length || (node.textContent ? 1 : 0);
    const last = lines[lines.length - 1];
    const lastLineFill = last && containerWidthPx ? clamp(last.width / containerWidthPx, 0, 1) : 0;
    return { lineCount, lastLineFill };
  }

  function measureTextLayout(text) {
    if (!STATE.measurerText || !STATE.layout) return { lineCount: 1, lastLineFill: 1 };
    STATE.measurerText.textContent = applyTextCase(text);
    if (!text) return { lineCount: 0, lastLineFill: 0 };
    return measureNodeLayout(STATE.measurerText, STATE.layout.textWidthPx, STATE.layout.targetLines);
  }

  function hasEnoughTextForPunctuation(layout) {
    if (!layout) return false;
    return layout.lineCount >= Math.max(1, STATE.layout ? STATE.layout.targetLines : 2) &&
      layout.lastLineFill >= CFG.minPunctuationLastLineFill;
  }

  function batchVerifyOverflows(pending) {
    return [];
  }

  function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function getChunkBuildSignature() {
    const layout = STATE.layout || {};
    const first = STATE.words[0];
    const last = STATE.words[STATE.words.length - 1];
    return [
      STATE.videoId || currentVideoId() || '',
      STATE.words.length,
      first ? first.start : '',
      last ? last.start : '',
      last ? last.text : '',
      layout.textWidthPx || '',
      layout.fontSizePx || '',
      layout.targetLines || '',
      STATE.settings.textSize,
      STATE.settings.font,
      STATE.settings.allCaps ? 'caps' : 'normal',
      STATE.settings.textBold ? 'bold' : 'normal',
      STATE.settings.debug ? 'debug' : 'normal',
    ].join('|');
  }

  async function chunkWords(words) {
    const chunks = [];
    const layout = STATE.layout;
    const canvasW = layout ? layout.textWidthPx : 0;
    const cfg = { ...CFG, targetLines: STATE.settings.targetLines };
    STATE.nextYieldAt = performance.now() + cfg.rebuildYieldMs;

    let cwWidths = null;
    let cwSpaceW = 0;
    if (canvasW > 0 && STATE.measurerText) {
      try {
        const style = window.getComputedStyle(STATE.measurerText);
        const cvs = document.createElement('canvas');
        const ctx = cvs.getContext('2d');
        ctx.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
        const lsPx = parseFloat(style.letterSpacing) || 0;
        cwSpaceW = ctx.measureText(' ').width + lsPx;
        cwWidths = new Array(words.length);
        for (let i = 0; i < words.length; i++) {
          const norm = String(words[i].text || '').replace(/\s+/g, ' ').trim();
          const tokens = norm ? norm.split(' ').filter(Boolean) : [];
          cwWidths[i] = tokens.map((tk) => {
            const d = applyTextCase(tk);
            return d ? ctx.measureText(d).width + lsPx * d.length : 0;
          });
        }
      } catch (e) { cwWidths = null; }
    }

    const wrapW = canvasW * cfg.wrapSafety;
    function fastLineInfo(from, to) {
      if (!cwWidths) return null;
      let x = 0, lines = 1, any = false;
      for (let i = from; i < to; i++) {
        for (const w of cwWidths[i]) {
          if (!w) continue;
          if (any && x + cwSpaceW + w > wrapW) { lines += 1; x = w; }
          else { x += any ? cwSpaceW + w : w; any = true; }
        }
      }
      return { lineCount: lines, lastLineFill: any ? Math.min(1, x / wrapW) : 0 };
    }
    function fastHasMinFill(from, to) {
      const fi = fastLineInfo(from, to);
      if (!fi) return null;
      return fi.lineCount >= Math.max(1, cfg.targetLines) && fi.lastLineFill >= cfg.minPunctuationLastLineFill;
    }
    const normalizeCaptionText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const joinWords = (from, to) => {
      let text = '';
      for (let i = from; i < to; i++) {
        const w = normalizeCaptionText(words[i].text);
        if (!w) continue;
        text = text ? text + ' ' + w : w;
      }
      return text;
    };

    const pushChunk = (startIndex, endExclusive, meta) => {
      if (endExclusive <= startIndex) return;
      const rawText = meta.text || joinWords(startIndex, endExclusive);
      if (!rawText) return;
      const startMs = words[startIndex].start;
      const lastWordStart = words[endExclusive - 1].start;
      const lastWordEnd = words[endExclusive - 1].end;
      const lastTimedPoint = lastWordEnd != null ? lastWordEnd : lastWordStart;
      const nextStart = words[endExclusive] ? words[endExclusive].start : null;
      const pauseAfterMs = nextStart != null ? nextStart - lastTimedPoint : null;
      const longPauseHideAtMs = (pauseAfterMs != null && pauseAfterMs >= cfg.longPauseThresholdMs)
        ? lastTimedPoint + cfg.longPauseHoldMs
        : null;
      let endMs = nextStart != null ? nextStart : lastWordStart + cfg.minDurMs;
      if (endMs - startMs < cfg.minDurMs) endMs = startMs + cfg.minDurMs;
      if (endMs - startMs > cfg.maxDurMs) endMs = startMs + cfg.maxDurMs;
      chunks.push({
        startMs,
        endMs,
        text: applyTextCase(rawText),
        rawText,
        lastWordStartMs: lastWordStart,
        lastWordEndMs: lastWordEnd != null ? lastWordEnd : null,
        nextStartMs: nextStart,
        pauseAfterMs,
        longPauseHideAtMs,
        reason: meta.reason || 'unknown',
      });
    };

    let start = 0;
    while (start < words.length) {
      let chosenEnd = -1;
      let reason = 'unknown';
      let chosenText = '';

      // 二分查找溢出边界（用 canvas 宽度，零 reflow）
      let overflowAt = words.length + 1;
      {
        let lo = start + 1;
        let hi = Math.min(words.length, start + cfg.maxWords);
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const lc = (fastLineInfo(start, mid) || measureTextLayout(joinWords(start, mid))).lineCount;
          if (lc > cfg.targetLines) { overflowAt = mid; hi = mid - 1; }
          else lo = mid + 1;
        }
      }
      const maxFit = overflowAt - 1;

      // 线性扫描：在能放下的范围内找"自然"断点
      let text = '';
      let lastFitEnd = start;
      let lastFitText = '';
      for (let end = start + 1; end <= Math.min(maxFit, words.length); end++) {
        const current = words[end - 1];
        const next = words[end];
        const curText = String(current.text || '').replace(/\s+/g, ' ').trim();
        text = text ? text + ' ' + curText : curText;
        const gapAfterMs = next ? next.start - current.start : 0;
        const breaks = classifyBreakChar(current.text);
        lastFitEnd = end;
        lastFitText = text;

        if (next && current.preserveBoundary && current.eventIndex !== next.eventIndex) {
          reason = 'manual_caption_event_boundary';
          chosenEnd = end; chosenText = text;
          break;
        }
        if (next && /^\s*(>>|<<)/.test(next.text)) {
          reason = 'speaker_change';
          chosenEnd = end; chosenText = text;
          break;
        }
        if (gapAfterMs >= cfg.hardPauseMs) {
          const fill = fastHasMinFill(start, end) != null
            ? fastHasMinFill(start, end)
            : hasEnoughTextForPunctuation(measureTextLayout(text));
          reason = fill ? 'hard_pause_after_min_fill' : 'hard_pause_before_min_fill';
          chosenEnd = end; chosenText = text;
          break;
        }
        if (breaks.terminal || breaks.clause) {
          const fill = fastHasMinFill(start, end) != null
            ? fastHasMinFill(start, end)
            : hasEnoughTextForPunctuation(measureTextLayout(text));
          if (fill) {
            reason = 'punctuation_after_min_fill';
            chosenEnd = end; chosenText = text;
            break;
          }
        }
        if (end - start >= cfg.maxWords) {
          reason = 'max_words';
          chosenEnd = end; chosenText = text;
          break;
        }
      }

      // 没有自然断点：用溢出边界 / 结尾兜底
      if (chosenEnd <= start) {
        if (overflowAt <= words.length && maxFit > start) {
          let end = maxFit;
          if (words[start].preserveBoundary) {
            let lineEnd = start;
            while (lineEnd < words.length && words[lineEnd].eventIndex === words[start].eventIndex) lineEnd += 1;
            const lineWords = lineEnd - start;
            const perCaption = maxFit - start;
            if (lineWords > perCaption) {
              const captions = Math.ceil(lineWords / perCaption);
              end = Math.min(start + Math.ceil(lineWords / captions), maxFit);
            }
          }
          reason = 'last_word_that_fits';
          chosenEnd = end;
          chosenText = end === lastFitEnd && lastFitText ? lastFitText : joinWords(start, end);
        } else if (lastFitEnd > start) {
          reason = 'end_of_captions';
          chosenEnd = lastFitEnd;
          chosenText = lastFitText;
        }
      }

      if (chosenEnd <= start) {
        chosenEnd = Math.min(start + 1, words.length);
        chosenText = joinWords(start, chosenEnd);
        reason = 'forced_single_word';
      }

      pushChunk(start, chosenEnd, { text: chosenText, reason });
      start = chosenEnd;

      if (performance.now() >= STATE.nextYieldAt) {
        await yieldToBrowser();
        STATE.nextYieldAt = performance.now() + cfg.rebuildYieldMs;
      }
    }

    debugLog('chunked', { chunks: chunks.length, reasons: chunks.map((c) => c.reason).slice(0, 40) });
    return chunks;
  }

  async function rebuildChunksForLayout(reason, deferOverlay) {
    const player = mountOverlay({ skipOverlayLayout: deferOverlay });
    if (!player || !STATE.words.length) {
      if (deferOverlay && STATE.overlay && STATE.layout) applyLayout(STATE.overlay, STATE.layout);
      return;
    }
    const signature = getChunkBuildSignature();
    if (STATE.chunks.length && signature === STATE.chunkBuildSignature) {
      if (deferOverlay && STATE.overlay && STATE.layout) applyLayout(STATE.overlay, STATE.layout);
      renderCurrentCaption(true);
      return;
    }
    if (signature === STATE.chunkBuildInFlightSignature) return;

    const requestId = ++STATE.chunkBuildRequestId;
    STATE.chunkBuildInFlightSignature = signature;
    STATE.nextYieldAt = performance.now() + CFG.rebuildYieldMs;
    const chunks = await chunkWords(STATE.words);
    if (STATE.chunkBuildInFlightSignature === signature) STATE.chunkBuildInFlightSignature = null;
    if (requestId !== STATE.chunkBuildRequestId) return;

    STATE.chunks = chunks;
    STATE.chunkBuildSignature = signature;
    log('rebuilt', chunks.length, 'chunks;', reason);
    if (deferOverlay && STATE.overlay && STATE.layout) applyLayout(STATE.overlay, STATE.layout);
    renderCurrentCaption(true);
  }

  async function waitForCurrentFont() {
    if (!document.fonts || !document.fonts.load || !STATE.layout) return;
    const family = FONT_LOAD_FAMILIES[STATE.settings.font];
    if (!family) return;
    const spec = (STATE.settings.textBold ? 700 : 400) + ' ' + Math.max(1, Math.round(STATE.layout.fontSizePx || 32)) + 'px ' + family;
    try { await document.fonts.load(spec); } catch (e) { /* 忽略 */ }
  }

  function rebuildAfterFontReady() {
    const player = mountOverlay({ skipOverlayLayout: true });
    if (!player || !STATE.words.length) {
      if (STATE.overlay && STATE.layout) applyLayout(STATE.overlay, STATE.layout);
      return;
    }
    const requestId = ++STATE.fontLoadRequestId;
    waitForCurrentFont().finally(() => {
      if (requestId !== STATE.fontLoadRequestId) return;
      rebuildChunksForLayout('font_ready', true);
    });
  }

  function scheduleResizeRebuild() {
    if (STATE.resizeTimerId) clearTimeout(STATE.resizeTimerId);
    STATE.resizeTimerId = setTimeout(() => {
      STATE.resizeTimerId = null;
      if (!STATE.words.length || !STATE.layout) return;
      if (STATE.chunks.length && getChunkBuildSignature() === STATE.chunkBuildSignature) {
        renderCurrentCaption(true);
        return;
      }
      rebuildChunksForLayout('resize');
    }, CFG.resizeRebuildMs);
  }

  /* ============================ 覆盖层挂载与布局 ============================ */

  function applyLayout(node, layout) {
    if (!node || !layout) return;
    const s = STATE.settings;
    node.style.setProperty('--kt-text-width', layout.textWidthPx + 'px');
    node.style.setProperty('--kt-font-size', layout.fontSizePx + 'px');
    node.style.setProperty('--kt-line-height', String(layout.lineHeight));
    node.style.setProperty('--kt-bg-opacity', String((Number(s.background) || 0) / 100));
    node.style.setProperty('--kt-font-family', FONT_FAMILIES[s.font] || FONT_FAMILIES.atkinson);
    node.style.setProperty('--kt-color', TEXT_COLORS[s.textColor] || TEXT_COLORS.white);
    node.style.setProperty('--kt-text-opacity', String((Number(s.textOpacity) || 100) / 100));
    node.style.setProperty('--kt-font-weight', s.textBold ? '700' : '400');
    node.style.setProperty('--kt-font-features', s.font === 'cascadia' ? '"liga" 0, "calt" 0' : 'normal');
    node.style.setProperty('--kt-text-shadow', s.textOutline
      ? '-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 -1.5px 0 #000, 0 1.5px 0 #000, -1.5px 0 0 #000, 1.5px 0 0 #000, 0 0 4px #000'
      : '0 1px 2px rgba(0, 0, 0, 0.9)');

    const isShorts = location.pathname.startsWith('/shorts/');

    /* ---- 自定义模式：水平/垂直滑块，把覆盖层自身 (posX%, posY%) 锚点对齐画面同比例点 ---- */
    if (s.positionMode === 'custom') {
      const posX = clamp(s.posX, 0, 100);
      const posY = clamp(s.posY, 0, 100);
      const playerEl = getPlayerElement();
      const video = playerEl ? playerEl.querySelector('video') : document.querySelector('video');
      const pr = playerEl ? playerEl.getBoundingClientRect() : null;
      const vr = video ? video.getBoundingClientRect() : null;
      node.style.bottom = 'auto';
      node.style.right = 'auto';
      if (pr && vr && vr.width > 0 && vr.height > 0) {
        const refX = vr.left + (posX / 100) * vr.width;
        const refY = vr.top + (posY / 100) * vr.height;
        node.style.left = '0px';
        node.style.top = Math.round(refY - pr.top) + 'px';
        node.style.transform = 'translate(' + Math.round(refX - pr.left) + 'px, 0) translate(' + (-posX) + '%, ' + (-posY) + '%)';
      } else {
        node.style.left = posX + '%';
        node.style.top = posY + '%';
        node.style.transform = 'translate(' + (-posX) + '%, ' + (-posY) + '%)';
      }
      return;
    }

    /* ---- 预设 21 宫格 ---- */
    const pos = PRESET_POSITIONS[s.position] || PRESET_POSITIONS['center-low'];
    let y = pos.y;
    if (isShorts && SHORTS_Y_REMAP[y] != null) y = SHORTS_Y_REMAP[y];
    node.style.bottom = 'auto';
    node.style.top = 'auto';
    node.style.right = 'auto';
    if (pos.x === 'left') {
      node.style.left = '8px';
      node.style.transform = 'none';
    } else if (pos.x === 'right') {
      node.style.right = '8px';
      node.style.left = 'auto';
      node.style.transform = 'none';
    } else {
      node.style.left = '50%';
    }
    if (y <= 8) {
      node.style.top = '8px';
      node.style.transform = pos.x === 'center' ? 'translateX(-50%)' : 'none';
      return;
    }
    if (y >= 92) {
      node.style.bottom = '8px';
      node.style.transform = pos.x === 'center' ? 'translateX(-50%)' : 'none';
      return;
    }
    const playerEl = getPlayerElement();
    const video = playerEl ? playerEl.querySelector('video') : document.querySelector('video');
    const pr = playerEl ? playerEl.getBoundingClientRect() : null;
    const vr = video ? video.getBoundingClientRect() : null;
    if (pr && vr && vr.height > 0) {
      const offset = vr.top - pr.top;
      if (offset + vr.height <= 0 || offset >= pr.height) {
        // 慢加载：视频还没归位，先用安全默认位，稍后重算
        node.style.left = '50%';
        node.style.bottom = '';
        node.style.top = '';
        node.style.transform = 'translateX(-50%)';
        if (!STATE.layoutSettleTimerId) {
          STATE.layoutSettleTimerId = setTimeout(() => {
            STATE.layoutSettleTimerId = null;
            mountOverlay();
            renderCurrentCaption(true);
          }, CFG.layoutSettleMs);
        }
        return;
      }
      if (y > 50) {
        let gap = Math.round(((100 - y) / 2 / 100) * vr.height);
        if (y === 82) gap = Math.max(gap, 50);
        node.style.bottom = Math.round(pr.height - (offset + vr.height) + gap) + 'px';
        node.style.transform = pos.x === 'center' ? 'translateX(-50%)' : 'none';
      } else {
        node.style.top = Math.round(offset + (y / 100) * vr.height) + 'px';
        node.style.transform = pos.x === 'center' ? 'translate(-50%, -50%)' : 'translateY(-50%)';
      }
      return;
    }
    node.style.transform = pos.x === 'center' ? 'translate(-50%, -50%)' : 'translateY(-50%)';
  }

  function mountOverlay(opts) {
    const o = opts || {};
    if (STATE.settings.enabled && !document.head.contains(captionHideStyle)) {
      document.head.appendChild(captionHideStyle);
    }
    const player = getPlayerElement();
    if (!player) {
      if (!o.noretry) setTimeout(() => mountOverlay(opts), 250);
      return null;
    }
    if (STATE.overlay && STATE.overlay.parentElement !== player) player.appendChild(STATE.overlay);
    if (STATE.measurer && STATE.measurer.parentElement !== player) player.appendChild(STATE.measurer);

    if (!STATE.overlay || !document.body.contains(STATE.overlay)) {
      const box = document.createElement('div');
      box.id = 'kt-overlay';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      box.setAttribute('aria-atomic', 'true');
      const text = document.createElement('div');
      text.className = 'kt-text';
      text.dir = 'auto';
      box.appendChild(text);
      player.appendChild(box);
      STATE.overlay = box;
      STATE.overlayText = text;
      box.addEventListener('pointerover', onOverlayPointerOver);
      box.addEventListener('pointerout', onOverlayPointerOut);
    }
    if (!STATE.measurer || !document.body.contains(STATE.measurer)) {
      const m = document.createElement('div');
      m.id = 'kt-measurer';
      const text = document.createElement('div');
      text.className = 'kt-text';
      text.dir = 'auto';
      m.appendChild(text);
      player.appendChild(m);
      STATE.measurer = m;
      STATE.measurerText = text;
    }

    const layout = getLayoutMetrics(player);
    if (layout) {
      STATE.layout = layout;
      if (!o.skipOverlayLayout) applyLayout(STATE.overlay, layout);
      applyLayout(STATE.measurer, layout);
    }

    if (typeof ResizeObserver === 'function' && !STATE.resizeObserver) {
      STATE.resizeObserver = new ResizeObserver((entries) => {
        const cr = entries[entries.length - 1] && entries[entries.length - 1].contentRect;
        const w = cr ? Math.round(cr.width) : 0;
        const h = cr ? Math.round(cr.height) : 0;
        if (w === STATE.lastResizeW && h === STATE.lastResizeH) return;
        STATE.lastResizeW = w;
        STATE.lastResizeH = h;
        if (STATE.resizeLayoutTimerId) clearTimeout(STATE.resizeLayoutTimerId);
        STATE.resizeLayoutTimerId = setTimeout(() => {
          STATE.resizeLayoutTimerId = null;
          mountOverlay({ noretry: true });
          renderCurrentCaption(true);
          scheduleResizeRebuild();
        }, CFG.resizeDebounceMs);
      });
    }
    if (STATE.resizeObserver) {
      if (STATE.resizeObservedPlayer !== player) {
        STATE.resizeObserver.disconnect();
        STATE.resizeObserver.observe(player);
        STATE.resizeObservedPlayer = player;
        STATE.resizeObservedVideo = null;
      }
      const pv = player.querySelector('video');
      if (pv && STATE.resizeObservedVideo !== pv) {
        STATE.resizeObserver.observe(pv);
        STATE.resizeObservedVideo = pv;
      }
    }
    return player;
  }

  /* ============================ 逐词渲染与时间轴同步 ============================ */

  function buildWordSpans(text) {
    const frag = document.createDocumentFragment();
    splitIntoWords(text).forEach((w, i) => {
      const span = document.createElement('span');
      span.className = 'kt-word';
      span.textContent = renderWord(w);
      span.dataset.index = String(i);
      span.addEventListener('pointerenter', handleWordEnter);
      span.addEventListener('pointerleave', handleWordLeave);
      span.addEventListener('pointerdown', handleWordDown);
      span.addEventListener('pointermove', handleWordMove);
      span.addEventListener('pointerup', handleWordUp);
      frag.appendChild(span);
    });
    return frag;
  }

  function renderCurrentCaption(force) {
    if (!STATE.overlay || !STATE.settings.enabled) return;
    if (areNativeCaptionsEnabled() === false) {
      clearOverlay();
      return;
    }
    if (!document.head.contains(captionHideStyle)) document.head.appendChild(captionHideStyle);

    const video = findVideo();
    if (!video) return;
    const ms = (video.currentTime || 0) * 1000 + CFG.lookaheadMs;
    let active = null;
    for (let i = 0; i < STATE.chunks.length; i++) {
      const c = STATE.chunks[i];
      const next = STATE.chunks[i + 1];
      const hideBeforeNext = c.longPauseHideAtMs != null && next && next.startMs > c.longPauseHideAtMs;
      const winEnd = hideBeforeNext ? c.longPauseHideAtMs : (next ? next.startMs : c.endMs);
      if (ms >= c.startMs && ms < winEnd) { active = c; break; }
      if (ms < c.startMs) break;
    }
    const text = active ? active.text : '';
    if (!force && text === STATE.lastText) return;

    if (STATE.overlayText) {
      STATE.overlayText.textContent = '';
      STATE.overlayText.appendChild(buildWordSpans(text));
    }
    STATE.lastText = text;
    STATE.activeChunkText = text;
    STATE.activeChunkRaw = active ? active.rawText : '';
    STATE.overlay.dataset.empty = text ? '0' : '1';
    debugLog('render', { text: text.slice(0, 80), reason: active ? active.reason : 'none' });
  }

  function startPolling() {
    if (STATE.pollId) return;
    STATE.pollId = setInterval(() => renderCurrentCaption(), CFG.pollMs);
  }
  function stopPolling() {
    if (STATE.pollId) clearInterval(STATE.pollId);
    STATE.pollId = null;
  }

  /* ============================ 悬停 / 选择 / 气泡 ============================ */

  function getWordIndex(el) {
    const raw = el.getAttribute('data-index');
    if (raw == null) return null;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  }

  function getSelectedText() {
    return Array.from(STATE.selectedWords)
      .sort((a, b) => (getWordIndex(a) ?? 1e9) - (getWordIndex(b) ?? 1e9))
      .map((w) => w.textContent || '')
      .join('')
      .trim();
  }

  function applySelectionRange() {
    const fi = STATE.firstSel ? getWordIndex(STATE.firstSel) : null;
    const li = STATE.lastSel ? getWordIndex(STATE.lastSel) : null;
    if (fi == null || li == null) {
      clearSelection(true);
      return;
    }
    STATE.selectedWords.forEach((w) => w.classList.remove('kt-word-selected'));
    STATE.selectedWords.clear();
    if (!STATE.overlayText) return;
    STATE.overlayText.querySelectorAll('.kt-word').forEach((w) => {
      const i = getWordIndex(w);
      if (i == null || i < fi || i > li) return;
      STATE.selectedWords.add(w);
      w.classList.add('kt-word-selected');
    });
  }

  function updateSelection(node) {
    const idx = getWordIndex(node);
    if (idx == null) return;
    const fi = STATE.firstSel ? getWordIndex(STATE.firstSel) : null;
    const li = STATE.lastSel ? getWordIndex(STATE.lastSel) : null;
    if (fi == null || idx < fi) STATE.firstSel = node;
    if (li == null || idx > li) STATE.lastSel = node;
    applySelectionRange();
  }

  function clearSelection(keepActive) {
    STATE.firstSel = null;
    STATE.lastSel = null;
    STATE.selectedWords.forEach((w) => w.classList.remove('kt-word-selected'));
    STATE.selectedWords.clear();
    if (!keepActive) applyActiveWord(null);
  }

  function applyActiveWord(node) {
    STATE.activeWord = node || null;
    if (STATE.overlayText) {
      STATE.overlayText.querySelectorAll('.kt-word-active').forEach((w) => {
        if (w !== node) w.classList.remove('kt-word-active');
      });
    }
    if (node) node.classList.add('kt-word-active');
  }

  function cancelHoverTimer() {
    if (STATE.hoverTimer) clearTimeout(STATE.hoverTimer);
    STATE.hoverTimer = null;
  }

  function abortActiveRequests() {
    if (STATE.abortController) {
      STATE.abortController.abort();
      STATE.abortController = null;
    }
    STATE.activeTranslation = null;
    STATE.activeLine = null;
  }

  function handleWordEnter(e) {
    const target = e.currentTarget;
    const extend = e.shiftKey || STATE.settings.alwaysMultipleSelection;
    if (!extend) clearSelection(true);
    updateSelection(target);
    applyActiveWord(target);
    scheduleTooltip();
  }

  function handleWordLeave(e) {
    const rel = e.relatedTarget;
    if (rel && rel instanceof Element && (rel.classList.contains('kt-word') || rel.id === 'kt-overlay')) return;
    onSubtitleLeave();
  }

  function onOverlayPointerOver(e) {
    const rel = e.relatedTarget;
    if (rel && STATE.overlay && STATE.overlay.contains(rel)) return;
    pauseController.pause();
  }

  function onOverlayPointerOut(e) {
    const rel = e.relatedTarget;
    if (rel && STATE.overlay && STATE.overlay.contains(rel)) return;
    onSubtitleLeave();
  }

  function onSubtitleLeave() {
    cancelHoverTimer();
    abortActiveRequests();
    STATE.hoverGen += 1;
    clearSelection(false);
    hideTooltip();
    pauseController.resume();
  }

  /* ---- 气泡 ---- */

  function ensureTooltip() {
    if (STATE.tooltip && document.body.contains(STATE.tooltip)) return;
    const box = document.createElement('div');
    box.id = 'kt-tooltip';
    const word = document.createElement('div');
    word.className = 'kt-tooltip-word';
    const meta = document.createElement('div');
    meta.className = 'kt-tooltip-meta';
    const label = document.createElement('div');
    label.className = 'kt-tooltip-line-label';
    const line = document.createElement('div');
    line.className = 'kt-tooltip-line';
    box.appendChild(word);
    box.appendChild(meta);
    box.appendChild(label);
    box.appendChild(line);
    (document.fullscreenElement || document.body).appendChild(box);
    STATE.tooltip = box;
  }

  function tooltipSection(name) {
    if (!STATE.tooltip) return null;
    return STATE.tooltip.querySelector('.kt-tooltip-' + name);
  }

  function setTooltipSection(name, text) {
    const el = tooltipSection(name);
    if (!el) return;
    el.textContent = text || '';
    if (name === 'meta' || name === 'line-label') el.style.display = text ? '' : 'none';
  }

  function styleTooltip() {
    const box = STATE.tooltip;
    if (!box) return;
    const s = STATE.settings;
    const tt = s.tooltip;
    const styleOf = (el) => (el ? window.getComputedStyle(el) : null);
    const subStyle = styleOf(STATE.overlayText || STATE.overlay);
    if (s.tooltipFollowSubtitle && subStyle) {
      box.style.fontFamily = subStyle.fontFamily || box.style.fontFamily;
      box.style.color = subStyle.color || '#fff';
      box.style.fontSize = subStyle.fontSize || '16px';
      box.style.background = subStyle.backgroundImage && subStyle.backgroundImage !== 'none'
        ? subStyle.backgroundImage
        : 'rgba(8, 8, 8, 0.85)';
      box.style.textShadow = subStyle.textShadow || 'none';
      return;
    }
    const TT_FONTS = {
      'monospaced-serif': '"Courier New", Courier, monospace',
      'proportional-serif': '"Times New Roman", Times, Georgia, serif',
      'monospaced-sans-serif': '"Deja Vu Sans Mono", "Lucida Console", Monaco, Consolas, monospace',
      'proportional-sans-serif': '"YouTube Noto", Roboto, Arial, "Noto Sans", sans-serif',
      casual: '"Comic Sans MS", "Segoe Print", cursive',
      cursive: '"Monotype Corsiva", "URW Chancery L", "Dancing Script", cursive',
      'small-capitals': 'Arial, Helvetica, "Marcellus SC", sans-serif',
    };
    const TT_COLORS = {
      white: 'rgb(255,255,255)', yellow: 'rgb(255,255,0)', green: 'rgb(0,255,0)', cyan: 'rgb(0,255,255)',
      blue: 'rgb(0,0,255)', magenta: 'rgb(255,0,255)', red: 'rgb(255,0,0)', black: 'rgb(8,8,8)',
    };
    const TT_SIZES = { '50%': '11.27px', '75%': '16.9px', '100%': '22.53px', '150%': '28.17px', '200%': '33.8px', '300%': '39.43px', '400%': '45.07px' };
    const TT_OPAC = { '25%': 0.25, '50%': 0.5, '75%': 0.75, '100%': 1 };
    const TT_BG_OPAC = { '0%': 0, '25%': 0.25, '50%': 0.5, '75%': 0.75, '100%': 1 };
    const TT_EDGES = {
      none: 'none',
      'drop-shadow': 'rgb(34,34,34) 1.4px 1.4px 2.1px',
      raised: 'rgb(34,34,34) 1px 1px 0px, rgb(34,34,34) 1.5px 1.5px 0px, rgb(34,34,34) 2px 2px 0px',
      depressed: 'rgb(204,204,204) 1px 1px 0px, rgb(34,34,34) -1px -1px 0px',
      outline: 'rgb(34,34,34) 0 0 1.4px, rgb(34,34,34) 0 0 1.4px',
    };
    const alpha = (color, op) => {
      const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
      if (!m) return color;
      return 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + op + ')';
    };
    const sub = styleOf(STATE.overlayText || STATE.overlay);
    const subColor = sub ? sub.color : '#ffffff';
    const subSize = sub ? sub.fontSize : '22.53px';
    const subBg = sub ? sub.backgroundColor : 'rgb(8,8,8)';

    if (tt.fontFamily === 'small-capitals') {
      box.style.fontFamily = TT_FONTS['small-capitals'];
      box.style.fontVariant = 'small-caps';
    } else {
      box.style.fontFamily = tt.fontFamily === 'auto' ? sub.fontFamily : (TT_FONTS[tt.fontFamily] || sub.fontFamily);
      box.style.fontVariant = 'normal';
    }
    const fontColor = tt.fontColor === 'auto' ? subColor : (TT_COLORS[tt.fontColor] || subColor);
    box.style.color = tt.fontOpacity === 'auto' ? fontColor : alpha(fontColor, TT_OPAC[tt.fontOpacity] != null ? TT_OPAC[tt.fontOpacity] : 1);
    box.style.fontSize = tt.fontSize === 'auto' ? subSize : (TT_SIZES[tt.fontSize] || subSize);
    box.style.background = tt.backgroundColor === 'auto' ? subBg : alpha(TT_COLORS[tt.backgroundColor] || subBg, TT_BG_OPAC[tt.backgroundOpacity] != null ? TT_BG_OPAC[tt.backgroundOpacity] : 1);
    box.style.textShadow = tt.characterEdgeStyle === 'auto' ? (sub ? sub.textShadow : 'none') : (TT_EDGES[tt.characterEdgeStyle] || 'none');
  }

  function positionTooltip() {
    const box = STATE.tooltip;
    const overlay = STATE.overlay;
    const video = findVideo();
    if (!box || !overlay || !video) return;
    const vr = video.getBoundingClientRect();
    const or = overlay.getBoundingClientRect();
    const anchor = STATE.activeWord ? STATE.activeWord.getBoundingClientRect() : null;
    box.style.visibility = 'hidden';
    box.style.maxWidth = Math.max(180, vr.width - CFG.tooltipMargin * 2) + 'px';
    const tw = box.offsetWidth;
    const th = box.offsetHeight;
    let left = (anchor ? anchor.left : or.left + or.width / 2) + window.scrollX;
    left = Math.min(left, vr.right - tw - CFG.tooltipMargin + window.scrollX);
    left = Math.max(left, vr.left + CFG.tooltipMargin + window.scrollX);
    box.style.left = left + 'px';
    const overlayCenter = or.top + or.height / 2;
    const videoCenter = vr.top + vr.height / 2;
    if (overlayCenter <= videoCenter) {
      box.style.top = (or.bottom + CFG.tooltipGap + window.scrollY) + 'px';
    } else {
      box.style.top = Math.max(vr.top + window.scrollY, or.top - th - CFG.tooltipGap + window.scrollY) + 'px';
    }
    /* 关键：用内联样式显式置为可见（内联优先级高于 class，反过来写会永远不可见） */
    box.style.visibility = 'visible';
    box.classList.add('kt-visible');
  }

  function hideTooltip() {
    if (STATE.tooltip) {
      STATE.tooltip.style.visibility = 'hidden';
      STATE.tooltip.classList.remove('kt-visible');
    }
  }

  function scheduleTooltip() {
    cancelHoverTimer();
    const selText = getSelectedText();
    if (!selText) return;
    const lineText = STATE.settings.sentenceTranslation ? STATE.activeChunkRaw : '';
    const wordHit = !!cacheGet(STATE.wordCache, selText);
    const lineOk = !lineText || !!cacheGet(STATE.lineCache, lineText);
    if (wordHit && lineOk) {
      startTooltip();
      return;
    }
    STATE.hoverTimer = setTimeout(startTooltip, CFG.hoverDelayMs);
  }

  function startTooltip() {
    const selText = getSelectedText();
    if (!selText) return;
    const gen = ++STATE.hoverGen;
    const lineText = STATE.settings.sentenceTranslation ? (STATE.activeChunkRaw || '') : '';
    const controller = new AbortController();
    abortActiveRequests();
    STATE.abortController = controller;
    STATE.activeTranslation = null;
    STATE.activeLine = null;

    ensureTooltip();
    setTooltipSection('word', t('loading'));
    setTooltipSection('meta', '');
    setTooltipSection('line-label', lineText ? t('lineLabel') : '');
    setTooltipSection('line', lineText ? t('loading') : '');
    try {
      styleTooltip();
      positionTooltip();
    } catch (err) {
      warn('tooltip 渲染失败:', err);
      showNotification(t('translationFailed'), true);
    }

    const wordPromise = translateCached('word', selText, controller.signal);
    STATE.activeTranslation = { text: selText, promise: wordPromise };
    wordPromise.then((data) => {
      if (gen !== STATE.hoverGen) return;
      if (!data || !data.translatedText) {
        setTooltipSection('word', t('translationFailed'));
        tooltipSection('word').classList.add('kt-tooltip-error');
        return;
      }
      setTooltipSection('word', data.translatedText);
      const metaParts = [data.transliteration, data.transcription].filter(Boolean);
      const dict = data.dictionary || '';
      setTooltipSection('meta', (metaParts.length ? metaParts.join('  ·  ') + (dict ? '\n' : '') : '') + dict);
      positionTooltip();
    }).catch(() => {
      if (gen !== STATE.hoverGen) return;
      setTooltipSection('word', t('translationFailed'));
      const el = tooltipSection('word');
      if (el) el.classList.add('kt-tooltip-error');
    });

    if (lineText) {
      const linePromise = translateCached('line', lineText, controller.signal);
      STATE.activeLine = { text: lineText, promise: linePromise };
      linePromise.then((data) => {
        if (gen !== STATE.hoverGen) return;
        setTooltipSection('line', data && data.translatedText ? data.translatedText : t('translationFailed'));
        positionTooltip();
      }).catch(() => {
        if (gen !== STATE.hoverGen) return;
        setTooltipSection('line', t('translationFailed'));
      });
    }
  }

  /* ---- 点击动作（复制译文/原文/无动作） ---- */

  function handleWordDown(e) {
    STATE.dragState = { x: e.clientX, y: e.clientY, dragging: false };
  }

  function handleWordMove(e) {
    if (!STATE.dragState || STATE.dragState.dragging) return;
    const dx = Math.abs(e.clientX - STATE.dragState.x);
    const dy = Math.abs(e.clientY - STATE.dragState.y);
    if (dx > CFG.dragThresholdPx || dy > CFG.dragThresholdPx) STATE.dragState.dragging = true;
  }

  async function resolveWordTranslation(text) {
    if (STATE.activeTranslation && STATE.activeTranslation.text === text) {
      const data = await STATE.activeTranslation.promise.catch(() => null);
      if (data) return data;
    }
    return translateCached('word', text);
  }

  function copyText(text) {
    return new Promise((resolve) => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => resolve(true)).catch(() => resolve(legacyCopy(text)));
          return;
        }
      } catch (e) { /* 继续走兜底 */ }
      resolve(legacyCopy(text));
    });
  }

  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  function handleWordUp() {
    if (STATE.dragState && STATE.dragState.dragging) return;
    const action = STATE.settings.leftClickAction;
    if (action === 'nothing') return;
    const selText = getSelectedText();
    if (!selText) return;
    resolveWordTranslation(selText)
      .then((data) => {
        if (!data || !data.translatedText) {
          showNotification(t('translationFailed'), true);
          return;
        }
        const text = action === 'copy-translation' ? data.translatedText : (data.originalText || selText);
        copyText(text).then((ok) => {
          const successKey = action === 'copy-translation' ? 'copiedTranslation' : 'copiedOriginal';
          showNotification(ok ? t(successKey) : t('copyFailed'), !ok);
        });
      })
      .catch(() => showNotification(t('translationFailed'), true));
  }

  /* ---- 操作通知 ---- */

  function showNotification(text, isError) {
    if (!STATE.settings.showNotifications && !isError) return;
    if (!STATE.notification || !document.body.contains(STATE.notification)) {
      const n = document.createElement('div');
      n.id = 'kt-notification';
      (document.fullscreenElement || document.body).appendChild(n);
      STATE.notification = n;
    }
    const video = findVideo();
    STATE.notification.textContent = text;
    STATE.notification.classList.add('kt-visible');
    if (video) {
      const r = video.getBoundingClientRect();
      STATE.notification.style.left = (r.left + 65) + 'px';
      STATE.notification.style.top = (r.top + 40) + 'px';
    }
    clearTimeout(STATE.notification.timer);
    STATE.notification.timer = setTimeout(() => {
      STATE.notification.classList.remove('kt-visible');
    }, CFG.notificationMs);
  }

  /* ============================ 暂停控制器（claim 对账） ============================ */

  const pauseController = {
    claimedVideo: null,
    onExternalPlay: null,
    pause() {
      if (!STATE.settings.autoPause) return;
      const video = findVideo();
      if (!video || video.paused) return;
      video.pause();
      this.claim(video);
    },
    resume() {
      const video = this.claimedVideo;
      if (!video) return;
      this.release();
      video.play().catch(() => { /* 自动播放策略拒绝就保持暂停 */ });
    },
    claim(video) {
      this.release();
      this.claimedVideo = video;
      this.onExternalPlay = () => this.release();
      video.addEventListener('play', this.onExternalPlay);
    },
    release() {
      if (this.claimedVideo && this.onExternalPlay) {
        this.claimedVideo.removeEventListener('play', this.onExternalPlay);
      }
      this.claimedVideo = null;
      this.onExternalPlay = null;
    },
    destroy() {
      this.release();
    },
  };

  /* ============================ 原生 CC 状态与字幕加载触发链 ============================ */

  function areNativeCaptionsEnabled() {
    if (location.pathname.startsWith('/shorts/')) return true;
    const player = getPlayerElement();
    const button = (player && player.querySelector('.ytp-subtitles-button')) || document.querySelector('.ytp-subtitles-button');
    if (!button) return youtubeIsDrawingCaptions();
    const aria = button.getAttribute('aria-pressed');
    if (aria === 'true') return true;
    if (aria === 'false') return false;
    return button.classList.contains('ytp-button-active');
  }

  function youtubeIsDrawingCaptions() {
    const container = document.getElementById('ytp-caption-window-container');
    if (!container) return null;
    for (const win of container.querySelectorAll('.caption-window')) {
      if (win.hasAttribute('data-kt-pip')) continue;
      if ((win.textContent || '').trim()) return true;
    }
    return null; // 不可知 ≠ 关闭
  }

  function watchCaptionsButton() {
    if (STATE.captionsWatcher) return;
    const player = getPlayerElement() || document.body;
    if (!player) return;
    STATE.captionsWatcher = new MutationObserver(() => {
      if (!areNativeCaptionsEnabled()) return;
      if (!STATE.settings.enabled || STATE.chunks.length) return;
      stopWatchingCaptionsButton();
      if (STATE.words.length) {
        rebuildChunksForLayout('captions_came_on');
        startPolling();
      } else {
        triggerCaptionLoad();
      }
    });
    try {
      const noButton = !((getPlayerElement() && getPlayerElement().querySelector('.ytp-subtitles-button')) || document.querySelector('.ytp-subtitles-button'));
      STATE.captionsWatcher.observe(player, {
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-pressed', 'title'],
        childList: noButton,
      });
    } catch (e) {
      STATE.captionsWatcher = null;
    }
  }

  function stopWatchingCaptionsButton() {
    if (!STATE.captionsWatcher) return;
    try { STATE.captionsWatcher.disconnect(); } catch (e) { /* 忽略 */ }
    STATE.captionsWatcher = null;
  }

  function toggleNativeCaptions() {
    const player = getPlayerElement();
    const button = (player && player.querySelector('.ytp-subtitles-button')) || document.querySelector('.ytp-subtitles-button');
    if (!button || STATE.captionsToggles >= CFG.maxCaptionsToggles) return false;
    STATE.captionsToggles += 1;
    debugLog('toggling_cc', { count: STATE.captionsToggles });
    try { button.click(); } catch (e) { return false; }
    const putBack = () => {
      if (button.getAttribute('aria-pressed') !== 'true') {
        try { button.click(); } catch (e) { /* 忽略 */ }
        return;
      }
      if (STATE.words.length && !STATE.chunks.length) {
        rebuildChunksForLayout('captions_back_on');
        startPolling();
      }
    };
    setTimeout(putBack, 200);
    setTimeout(putBack, 1200);
    setTimeout(putBack, 3000);
    return true;
  }

  function readCaptionTracks() {
    const pr = window.ytInitialPlayerResponse;
    return pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
      pr.captions.playerCaptionsTracklistRenderer.captionTracks;
  }

  function isCaptionsApiReady(player) {
    if (!player || typeof player.getOptions !== 'function') return false;
    try {
      const options = player.getOptions('captions');
      return Array.isArray(options) && options.length > 0;
    } catch (e) { return false; }
  }

  function clearTriggerRetry() {
    if (STATE.triggerRetryId) clearTimeout(STATE.triggerRetryId);
    STATE.triggerRetryId = null;
  }

  function triggerCaptionLoad() {
    if (!STATE.videoId || !STATE.asrLang || !STATE.settings.enabled || STATE.chunks.length) return;

    if (!areNativeCaptionsEnabled()) {
      debugLog('cc_off_waiting');
      watchCaptionsButton();
      return;
    }

    if (STATE.words.length && !STATE.chunks.length) {
      clearTriggerRetry();
      rebuildChunksForLayout('captions_came_on');
      startPolling();
      return;
    }

    const player = getPlayerElement();
    if (!player || typeof player.setOption !== 'function') {
      clearTriggerRetry();
      STATE.triggerRetryId = setTimeout(() => {
        STATE.triggerRetryId = null;
        triggerCaptionLoad();
      }, 300);
      return;
    }

    if (typeof player.loadModule === 'function') {
      try { player.loadModule('captions'); } catch (e) { /* 忽略 */ }
    }
    if (!isCaptionsApiReady(player)) {
      clearTriggerRetry();
      STATE.triggerRetryId = setTimeout(() => {
        STATE.triggerRetryId = null;
        triggerCaptionLoad();
      }, 300);
      return;
    }

    STATE.triggerAttempts += 1;
    STATE.triggered = true;
    if (!STATE.firstTriggerAtMs) STATE.firstTriggerAtMs = performance.now();
    if (STATE.triggerAttempts === CFG.toggleAfterAttempts) toggleNativeCaptions();
    debugLog('trigger_attempt', { attempt: STATE.triggerAttempts, lang: STATE.asrLang });

    let requested = false;
    try {
      player.setOption('captions', 'reload', true);
      requested = true;
    } catch (e) { /* 忽略 */ }

    if (STATE.statusMode !== 'loading') setStatus('loading');

    clearTriggerRetry();
    STATE.triggerRetryId = setTimeout(() => {
      STATE.triggerRetryId = null;
      if (STATE.chunks.length || !STATE.settings.enabled || !STATE.videoId) return;
      if (!areNativeCaptionsEnabled()) {
        watchCaptionsButton();
        return;
      }
      if (!requested || STATE.triggerAttempts < CFG.maxTriggerAttempts) {
        triggerCaptionLoad();
        return;
      }
      const waitedMs = performance.now() - STATE.firstTriggerAtMs;
      if (waitedMs < CFG.giveUpAfterMs) {
        clearTriggerRetry();
        STATE.triggerRetryId = setTimeout(() => {
          STATE.triggerRetryId = null;
          triggerCaptionLoad();
        }, CFG.slowRetryMs);
        return;
      }
      warn('timedtext 未被拦截，放弃');
      setStatus('error');
    }, CFG.triggerRetryMs);
  }

  function clearNavRetry() {
    if (STATE.navRetryId) clearTimeout(STATE.navRetryId);
    STATE.navRetryId = null;
    STATE.navRetryUntil = 0;
  }

  function scheduleNavRetry() {
    if (!STATE.videoId || STATE.chunks.length) return;
    if (!STATE.navRetryUntil) STATE.navRetryUntil = Date.now() + CFG.navRetryForMs;
    if (STATE.navRetryId) return;
    const remaining = STATE.navRetryUntil - Date.now();
    if (remaining <= 0) {
      clearNavRetry();
      STATE.statusMode = 'unavailable';
      return;
    }
    STATE.navRetryId = setTimeout(() => {
      STATE.navRetryId = null;
      checkNavigation();
    }, Math.min(CFG.navRetryMs, remaining));
  }

  function waitForPlayerThenTrigger() {
    if (STATE.statusMode === 'active' || !STATE.settings.enabled || STATE.chunks.length) return;
    if (STATE.triggerRetryId) return;
    clearTriggerRetry();
    STATE.triggerRetryId = setTimeout(() => {
      STATE.triggerRetryId = null;
      triggerCaptionLoad();
    }, 500);
  }

  function checkNavigation() {
    const vid = currentVideoId();
    if (!vid) {
      if (STATE.videoId) resetForNewVideo();
      return;
    }
    const isSameVideo = vid === STATE.videoId;
    if (!isSameVideo) {
      resetForNewVideo();
      STATE.videoId = vid;
      STATE.navRetryUntil = Date.now() + CFG.navRetryForMs;
    }

    const tracks = readCaptionTracks();
    if (!tracks || !tracks.length) {
      STATE.lastCaptionTracks = null;
      setStatus('loading');
      scheduleNavRetry();
      return;
    }
    clearNavRetry();
    const asr = tracks.find((track) => track.kind === 'asr');
    STATE.lastCaptionTracks = tracks.map((track) => ({
      kind: track.kind || null,
      languageCode: track.languageCode || null,
      name: track.name ? (track.name.simpleText || (track.name.runs || []).map((r) => r.text).join('')) : null,
      hasBaseUrl: Boolean(track.baseUrl),
    }));
    if (!asr) {
      STATE.statusMode = 'unavailable';
      return;
    }
    STATE.asrLang = asr.languageCode || 'en';
    log('asr track lang =', STATE.asrLang);
    if (STATE.settings.enabled && !STATE.chunks.length) {
      setStatus('loading');
      waitForPlayerThenTrigger();
    }
  }

  /* ============================ 覆盖层开关 / 重置 / 状态 ============================ */

  function clearOverlay() {
    if (STATE.overlayText) STATE.overlayText.textContent = '';
    if (STATE.overlay) STATE.overlay.dataset.empty = '1';
    STATE.lastText = null;
    STATE.activeChunkText = '';
    STATE.activeChunkRaw = '';
    cancelHoverTimer();
    abortActiveRequests();
    clearSelection(false);
    hideTooltip();
    pauseController.resume();
    if (document.head.contains(captionHideStyle)) document.head.removeChild(captionHideStyle);
  }

  function setEnabled(enabled) {
    STATE.settings.enabled = Boolean(enabled);
    window.__ktEnabled = STATE.settings.enabled;
    if (STATE.settings.enabled) {
      if (!areNativeCaptionsEnabled()) {
        clearOverlay();
        watchCaptionsButton();
        return;
      }
      if (STATE.chunks.length) {
        mountOverlay();
        startPolling();
        renderCurrentCaption(true);
      } else if (STATE.words.length) {
        rebuildChunksForLayout('enabled');
        startPolling();
      } else if (STATE.asrLang && !STATE.triggered) {
        waitForPlayerThenTrigger();
      }
    } else {
      stopPolling();
      clearOverlay();
    }
  }

  function setStatus(mode) {
    STATE.statusMode = mode;
    if (mode === 'error' && STATE.settings.enabled) {
      mountOverlay({ noretry: true });
      flashOverlay(t('captionsFailed'));
    }
  }

  function flashOverlay(msg) {
    if (!STATE.overlay || !STATE.overlayText) return;
    STATE.overlayText.textContent = msg;
    STATE.overlay.dataset.empty = '0';
    setTimeout(() => {
      if (STATE.overlayText && STATE.overlayText.textContent === msg) {
        STATE.overlayText.textContent = '';
        STATE.overlay.dataset.empty = '1';
      }
    }, 4000);
  }

  function resetForNewVideo() {
    stopPolling();
    clearNavRetry();
    clearTriggerRetry();
    if (STATE.resizeTimerId) clearTimeout(STATE.resizeTimerId);
    if (STATE.resizeLayoutTimerId) clearTimeout(STATE.resizeLayoutTimerId);
    if (STATE.layoutSettleTimerId) clearTimeout(STATE.layoutSettleTimerId);
    if (STATE.resizeObserver) STATE.resizeObserver.disconnect();
    if (STATE.overlay && STATE.overlay.parentNode) STATE.overlay.parentNode.removeChild(STATE.overlay);
    if (STATE.measurer && STATE.measurer.parentNode) STATE.measurer.parentNode.removeChild(STATE.measurer);
    if (document.head.contains(captionHideStyle)) document.head.removeChild(captionHideStyle);
    pauseController.destroy();
    STATE.pollId = null;
    STATE.overlay = null;
    STATE.overlayText = null;
    STATE.measurer = null;
    STATE.measurerText = null;
    STATE.layout = null;
    STATE.resizeObserver = null;
    STATE.resizeObservedPlayer = null;
    STATE.resizeObservedVideo = null;
    STATE.resizeTimerId = null;
    STATE.resizeLayoutTimerId = null;
    STATE.layoutSettleTimerId = null;
    STATE.lastResizeW = -1;
    STATE.lastResizeH = -1;
    STATE.measureRange = null;
    STATE.words = [];
    STATE.chunks = [];
    STATE.asrLang = null;
    STATE.videoId = null;
    STATE.lastText = null;
    STATE.activeChunkText = '';
    STATE.activeChunkRaw = '';
    STATE.triggered = false;
    STATE.triggerAttempts = 0;
    STATE.firstTriggerAtMs = 0;
    STATE.captionsToggles = 0;
    stopWatchingCaptionsButton();
    STATE.captionsWatcher = null;
    STATE.statusMode = 'idle';
    STATE.timedtextRequestCount = 0;
    STATE.timedtextResponseCount = 0;
    STATE.lastTimedtextResponse = null;
    STATE.lastCaptionTracks = null;
    STATE.chunkBuildSignature = null;
    STATE.chunkBuildInFlightSignature = null;
    STATE.fontLoadRequestId += 1;
    STATE.chunkBuildRequestId += 1;
    cancelHoverTimer();
    abortActiveRequests();
    clearSelection(false);
    hideTooltip();
    STATE.hoverGen += 1;
  }

  const captionHideStyle = document.createElement('style');
  captionHideStyle.textContent = '.ytp-caption-window-container{visibility:hidden!important}';

  /* ============================ 调试诊断 ============================ */

  document.documentElement.addEventListener('kt-debug-download', () => {
    const report = {
      at: new Date().toISOString(),
      url: location.href,
      videoId: STATE.videoId,
      settings: STATE.settings,
      statusMode: STATE.statusMode,
      chunks: STATE.chunks.length,
      words: STATE.words.length,
      timedtextRequests: STATE.timedtextRequestCount,
      timedtextResponses: STATE.timedtextResponseCount,
      lastCaptionTracks: STATE.lastCaptionTracks,
      caches: { word: STATE.wordCache.size, line: STATE.lineCache.size },
      logs: STATE.debugLogs.slice(-200),
      chunksPreview: STATE.chunks.slice(0, 60).map((c) => ({ s: c.startMs, e: c.endMs, reason: c.reason, text: (c.text || '').slice(0, 60) })),
    };
    try {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kt-debug-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    } catch (e) { /* 忽略 */ }
  });

  /* ============================ 导航监听与启动 ============================ */

  function handleUrlChange() {
    const vid = currentVideoId();
    if (vid && vid !== STATE.videoId) checkNavigation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkNavigation, { once: true });
  } else {
    checkNavigation();
  }

  document.addEventListener('yt-navigate-start', () => {
    if (STATE.videoId && currentVideoId() !== STATE.videoId) resetForNewVideo();
  }, true);

  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(checkNavigation, 0);
  }, true);

  setInterval(handleUrlChange, 1000);

  bootSettings();

  /* 仅供自动化测试访问（不影响插件运行） */
  window.__ktApi = {
    normalizeSettings,
    splitIntoWords,
    getTextEventInfo,
    extractWords,
    chunkWords,
    STATE,
  };
})();
