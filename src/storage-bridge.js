/* 设置桥（ISOLATED world content script）
 *
 * MAIN world 的 inject.js 需要拦截 YouTube 页面自己的请求，但它拿不到 chrome.* API。
 * 本脚本在隔离世界运行，负责三件事：
 *   1. 把 chrome.storage.local 里的设置同步进页面（dataset + CustomEvent）
 *   2. 把页面产生的翻译缓存批量写回 storage.local
 *   3. 把 Google/Bing 翻译请求转发给 background service worker（绕开页面 CSP 限制）
 */
(() => {
  'use strict';
  if (window.__ktBridgeLoaded) return;
  window.__ktBridgeLoaded = true;

  const SETTINGS_KEY = 'ktSettings';
  const CACHE_WORD_KEY = 'ktCacheWord';
  const CACHE_LINE_KEY = 'ktCacheLine';
  const MAX_CACHE_ENTRIES = 2000;

  function post(name, detail) {
    document.documentElement.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function syncSettings(value) {
    if (!value || typeof value !== 'object') return;
    document.documentElement.dataset.ktSettings = JSON.stringify(value);
    post('kt-settings-sync', value);
  }

  // 初始读取：设置 + 词/行两级缓存
  chrome.storage.local.get(
    { [SETTINGS_KEY]: null, [CACHE_WORD_KEY]: [], [CACHE_LINE_KEY]: [] },
    (items) => {
      if (chrome.runtime.lastError) return;
      syncSettings(items[SETTINGS_KEY]);
      if (Array.isArray(items[CACHE_WORD_KEY]) && items[CACHE_WORD_KEY].length) {
        document.documentElement.dataset.ktCacheWord = JSON.stringify(items[CACHE_WORD_KEY]);
      }
      if (Array.isArray(items[CACHE_LINE_KEY]) && items[CACHE_LINE_KEY].length) {
        document.documentElement.dataset.ktCacheLine = JSON.stringify(items[CACHE_LINE_KEY]);
      }
      post('kt-cache-init', {});
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SETTINGS_KEY]) syncSettings(changes[SETTINGS_KEY].newValue);
  });

  // 页面 → 存储：缓存批量写回（防爆配额，只保留最近条目）
  document.documentElement.addEventListener('kt-cache-save', (e) => {
    const detail = (e && e.detail) || {};
    if (!Array.isArray(detail.data) || !detail.data.length) return;
    const key = detail.kind === 'line' ? CACHE_LINE_KEY : CACHE_WORD_KEY;
    chrome.storage.local.set({ [key]: detail.data.slice(-MAX_CACHE_ENTRIES) }, () => void chrome.runtime.lastError);
  });

  // 页面 → 后台：翻译代理（Google/Bing 统一走这里；
  // MAIN world 页面代码受页面 CSP 约束，直连翻译接口可能被拦）
  document.documentElement.addEventListener('kt-translate-request', (e) => {
    const detail = (e && e.detail) || {};
    if (!detail.id || !detail.text) return;
    chrome.runtime.sendMessage(
      {
        action: 'translate',
        requestId: detail.id,
        translatorKey: detail.translatorKey || 'google',
        text: detail.text,
        sourceLanguageCode: detail.sl || 'auto',
        targetLanguageCode: detail.tl || 'en',
      },
      (resp) => {
        const err = chrome.runtime.lastError;
        post('kt-translate-response', {
          id: detail.id,
          ok: !err && resp && !resp.error,
          translatedText: resp && resp.translatedText,
          detectedLanguageCode: resp && resp.detectedLanguageCode,
          dictionary: resp && resp.dictionary,
          transliteration: resp && resp.transliteration,
          transcription: resp && resp.transcription,
          engine: resp && resp.engine,
          error: (err && err.message) || (resp && resp.error) || null,
        });
      }
    );
  });

  document.documentElement.addEventListener('kt-translate-abort', (e) => {
    const id = e && e.detail && e.detail.id;
    if (!id) return;
    chrome.runtime.sendMessage({ action: 'abortTranslate', requestId: id }, () => void chrome.runtime.lastError);
  });

  // 页面侧直连 Google：ISOLATED content script 走页面同款网络/代理，且不受页面 CSP 限制
  const GOOGLE_DIRECT_HOSTS = [
    'https://translate.googleapis.com/translate_a/single',
    'https://translate.google.com/translate_a/single',
  ];
  const GOOGLE_DIRECT_CLIENTS = ['dict-chrome-ex', 'at', 'gtx'];

  document.documentElement.addEventListener('kt-direct-request', (e) => {
    const detail = (e && e.detail) || {};
    if (!detail.id || !detail.text) return;
    (async () => {
      let lastErr = null;
      for (const host of GOOGLE_DIRECT_HOSTS) {
        for (const client of GOOGLE_DIRECT_CLIENTS) {
          try {
            const params = new URLSearchParams([
              ['client', client],
              ['q', detail.text],
              ['sl', detail.sl || 'auto'],
              ['tl', detail.tl || 'en'],
              ['hl', detail.tl || 'en'],
              ['dj', '1'],
              ['dt', 't'],
              ['dt', 'bd'],
              ['dt', 'rm'],
            ]);
            const resp = await fetch(host + '?' + params.toString());
            if (!resp.ok) throw new Error('google-http-' + resp.status);
            const data = await resp.json();
            if (!Array.isArray(data.sentences)) throw new Error('google-empty');
            let translated = '';
            let translit = '';
            let srcTranslit = '';
            for (const s of data.sentences) {
              translated += s.trans || '';
              translit += s.translit || '';
              srcTranslit += s.src_translit || '';
            }
            let dict = '';
            for (const d of data.dict || []) {
              dict += (d.pos || '') + ': ' + (d.terms || []).join(', ') + ';\n';
            }
            post('kt-direct-response', {
              id: detail.id,
              ok: true,
              translatedText: translated,
              detectedLanguageCode: data.src || '',
              dictionary: dict,
              transliteration: translit,
              transcription: srcTranslit,
            });
            return;
          } catch (err) {
            lastErr = err;
          }
        }
      }
      post('kt-direct-response', {
        id: detail.id,
        ok: false,
        error: String((lastErr && lastErr.message) || lastErr),
      });
    })();
  });

  // 弹窗 → 页面：请求下载调试诊断 JSON
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === 'kt-debug-download') {
      // 先让 MAIN world 把最新报告刷新到 dataset（ISOLATED 与 MAIN 共享 DOM），
      // 再由弹窗自己保存文件，绕开 YouTube 页面 CSP 对下载的拦截。
      document.documentElement.dispatchEvent(new CustomEvent('kt-debug-sync'));
      setTimeout(() => {
        sendResponse({ ok: true, report: document.documentElement.dataset.ktDebugReport || null });
      }, 80);
      return true; // 异步响应
    }
    // 反馈页：取当前视频链接 + 最近调试日志（仅用户勾选「附上诊断信息」时才会调用）
    if (message && message.action === 'kt-feedback-collect') {
      document.documentElement.dispatchEvent(new CustomEvent('kt-debug-sync'));
      setTimeout(async () => {
        let logs = '';
        try {
          const report = JSON.parse(document.documentElement.dataset.ktDebugReport || 'null');
          if (report && Array.isArray(report.logs)) {
            logs = report.logs
              .slice(-20)
              .map((x) => {
                const ts = new Date(x.at || Date.now()).toISOString().slice(11, 19);
                let detail = '';
                try { detail = JSON.stringify(x.detail || {}); } catch (e) { detail = ''; }
                return ts + ' ' + x.type + ' ' + detail.slice(0, 200);
              })
              .join('\n')
              .slice(0, 3800);
          }
        } catch (e) { /* dataset 缺失就当没有日志 */ }
        let uiLang = '';
        try {
          const items = await chrome.storage.local.get({ [SETTINGS_KEY]: null });
          uiLang = (items[SETTINGS_KEY] && items[SETTINGS_KEY].uiLang) || '';
        } catch (e) { /* 读不到就用空值 */ }
        sendResponse({ ok: true, url: location.href, uiLang, logs });
      }, 120);
      return true; // 异步响应
    }
    return false;
  });
})();
