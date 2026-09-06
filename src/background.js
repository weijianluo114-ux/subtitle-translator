'use strict';

/* background service worker
 *
 * 职责：
 *   1. Bing 翻译代理 —— www.bing.com 不发 CORS 头，页面内无法直连，只能在这里代发
 *   2. 安装/更新后，把 storage-bridge.js 重新注入已打开的 YouTube 标签
 *      （MAIN world 的 inject.js 随页面存活，不需要重注）
 *
 * Bing 方案说明：bing.com/translator 页面里带有短时有效的防滥用凭据
 * （IG / data-iid / params_AbusePreventionHelper），抓取后用于 ttranslatev3 接口。
 * 401/403 视为凭据过期，自动刷新重试一次。
 */

class BingTranslator {
  constructor() {
    this.pageUrl = 'https://www.bing.com/translator';
    this.translateUrl = 'https://www.bing.com/ttranslatev3';
    this.credentials = null;
    this.pendingCredentials = null;
    this.requestCount = 0;
    this.safetyMarginMs = 60000; // 提前 1 分钟刷新
    this.defaultLifetimeMs = 3600000;
  }

  parseCredentials(html) {
    const ig = /IG:"([A-Za-z0-9]+)"/.exec(html);
    const iid = /data-iid="([^"]+)"/.exec(html);
    const abuse = /params_AbusePreventionHelper\s*=\s*\[([^\]]+)\]/.exec(html);
    if (!ig || !abuse) throw new Error('bing-credentials-missing');

    const parts = abuse[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''));
    const key = Number(parts[0]);
    const token = parts[1];
    let lifetime = Number(parts[2]);
    if (!token || !Number.isFinite(key)) throw new Error('bing-credentials-bad');
    if (!Number.isFinite(lifetime) || lifetime <= 0) lifetime = this.defaultLifetimeMs;

    return {
      ig: ig[1],
      iid: iid ? iid[1] : 'translator.5023',
      key,
      token,
      expiresAt: Date.now() + lifetime - this.safetyMarginMs,
    };
  }

  async fetchCredentials() {
    const resp = await fetch(this.pageUrl, { credentials: 'omit' });
    if (!resp.ok) throw new Error('bing-page-http-' + resp.status);
    return this.parseCredentials(await resp.text());
  }

  async getCredentials() {
    if (this.credentials && this.credentials.expiresAt > Date.now()) {
      return this.credentials;
    }
    if (!this.pendingCredentials) {
      this.pendingCredentials = this.fetchCredentials()
        .then((c) => {
          this.credentials = c;
          return c;
        })
        .finally(() => {
          this.pendingCredentials = null;
        });
    }
    return this.pendingCredentials;
  }

  async request(text, sl, tl, creds, signal) {
    this.requestCount += 1;
    const body = new URLSearchParams({
      fromLang: sl && sl !== 'auto' ? sl : 'auto-detect',
      text,
      to: tl,
      token: creds.token,
      key: String(creds.key),
    });
    const url = new URL(this.translateUrl);
    url.searchParams.set('isVertical', '1');
    url.searchParams.set('IG', creds.ig);
    url.searchParams.set('IID', creds.iid + '.' + this.requestCount);

    const resp = await fetch(url, { method: 'POST', body, credentials: 'omit', signal });
    if (!resp.ok) {
      const err = new Error('bing-http-' + resp.status);
      err.status = resp.status;
      throw err;
    }
    return resp.json().catch(() => null);
  }

  async translate(text, sl, tl, signal) {
    const attempt = async (refresh) => {
      if (refresh) this.credentials = null;
      const creds = await this.getCredentials();
      return this.request(text, sl, tl, creds, signal);
    };

    let refreshed = false;
    let data;
    try {
      data = await attempt(false);
    } catch (err) {
      if (err && (err.status === 401 || err.status === 403)) {
        refreshed = true;
        data = await attempt(true);
      } else {
        throw err;
      }
    }

    const usable =
      Array.isArray(data) &&
      data[0] &&
      Array.isArray(data[0].translations) &&
      data[0].translations.length > 0;

    if (!usable && !refreshed) {
      // 200 但报错信封：凭据可能已过期，刷新重试一次
      refreshed = true;
      data = await attempt(true);
    }

    if (!Array.isArray(data) || !data[0] || !Array.isArray(data[0].translations) || !data[0].translations.length) {
      if (data && data.ShowCaptcha) {
        throw new Error('Bing 要求验证码：请打开 www.bing.com/translator 完成一次人机验证后再试');
      }
      throw new Error('Bing 拒绝了翻译请求（可能被限流）');
    }

    const first = data[0];
    const trans = first.translations[0];
    return {
      translatedText: trans ? trans.text : '',
      detectedLanguageCode:
        (first.detectedLanguage && first.detectedLanguage.language) || sl || '',
    };
  }
}

/* Google 翻译（免费公开端点，双域名 + 多客户端 ID 轮换应对 403/429 限流与域名不可达） */
class GoogleTranslator {
  constructor() {
    this.apiUrls = [
      'https://translate.googleapis.com/translate_a/single',
      'https://translate.google.com/translate_a/single',
    ];
    this.clientIds = ['dict-chrome-ex', 'at', 'gtx'];
    this.clientIdx = 0;
  }

  async translate(text, sl, tl, signal) {
    let lastErr = null;
    for (const apiUrl of this.apiUrls) {
      for (let attempt = 0; attempt < this.clientIds.length; attempt++) {
        const idx = (this.clientIdx + attempt) % this.clientIds.length;
        try {
          const params = new URLSearchParams([
            ['client', this.clientIds[idx]],
            ['q', text],
            ['sl', sl || 'auto'],
            ['tl', tl || 'en'],
            ['hl', tl || 'en'],
            ['dj', '1'],
            ['dt', 't'],
            ['dt', 'bd'],
            ['dt', 'rm'],
          ]);
          const resp = await fetch(apiUrl + '?' + params.toString(), { signal });
          if (!resp.ok) {
            const err = new Error('google-http-' + resp.status);
            err.status = resp.status;
            throw err;
          }
          const data = await resp.json();
          if (!Array.isArray(data.sentences)) throw new Error('google-empty');
          this.clientIdx = idx;
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
          return {
            translatedText: translated,
            detectedLanguageCode: data.src || '',
            dictionary: dict,
            transliteration: translit,
            transcription: srcTranslit,
          };
        } catch (err) {
          lastErr = err;
          const refused = err && (err.status === 403 || err.status === 429);
          if (!refused || attempt === this.clientIds.length - 1) break; // 非限流错误 → 换备用域名
        }
      }
    }
    throw lastErr || new Error('google-translate-failed');
  }
}

/* MyMemory 免费翻译（无需 key，国内通常可达，作为最后兜底） */
class MyMemoryTranslator {
  async translate(text, sl, tl, signal) {
    const src = sl && sl !== 'auto' ? String(sl).split('-')[0] : 'autodetect';
    const tgt = tl || 'zh-CN';
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) +
      '&langpair=' + encodeURIComponent(src + '|' + tgt);
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
      const err = new Error('mymemory-http-' + resp.status);
      err.status = resp.status;
      throw err;
    }
    const data = await resp.json();
    const translated = data && data.responseData && data.responseData.translatedText;
    if (!translated) throw new Error('mymemory-empty');
    return {
      translatedText: translated,
      detectedLanguageCode: (data.responseData && data.responseData.detectedLanguage) ||
        (data.matches && data.matches[0] && data.matches[0].source) || '',
      dictionary: '',
      transliteration: '',
      transcription: '',
    };
  }
}

const bing = new BingTranslator();
const google = new GoogleTranslator();
const mymemory = new MyMemoryTranslator();
const activeRequests = new Map();
let lastGoodEngine = null; // 记住上次成功的引擎，下次优先走它，避免每次都白试

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.action === 'translate') {
    const controller = new AbortController();
    activeRequests.set(message.requestId, controller);
    const all = { google, bing, mymemory };
    const primaryKey = message.translatorKey === 'bing' ? 'bing' : 'google';
    // 引擎顺序：上次成功的引擎 > 用户首选 > 其他（google → bing → mymemory）
    const order = [lastGoodEngine, primaryKey, 'google', 'bing', 'mymemory']
      .filter((k, i, arr) => k && all[k] && arr.indexOf(k) === i);

    (async () => {
      const errors = [];
      for (const key of order) {
        try {
          const r = await all[key].translate(message.text, message.sourceLanguageCode, message.targetLanguageCode, controller.signal);
          lastGoodEngine = key;
          sendResponse({
            translatedText: r.translatedText,
            detectedLanguageCode: r.detectedLanguageCode,
            dictionary: r.dictionary,
            transliteration: r.transliteration,
            transcription: r.transcription,
            engine: key,
          });
          return;
        } catch (err) {
          errors.push(key + ': ' + String((err && err.message) || err));
          if (controller.signal.aborted) break;
        }
      }
      sendResponse({ error: errors.join(' | ') });
    })().finally(() => activeRequests.delete(message.requestId));

    return true; // 异步响应
  }

  if (message.action === 'abortTranslate') {
    const controller = activeRequests.get(message.requestId);
    if (controller) {
      controller.abort();
      activeRequests.delete(message.requestId);
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function reconnectBridges() {
  try {
    const tabs = await chrome.tabs.query({
      url: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
    });
    for (const tab of tabs) {
      if (tab.id == null) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['storage-bridge.js'],
        });
      } catch (e) {
        /* 页面可能正在关闭，忽略 */
      }
    }
  } catch (e) {
    /* tabs.query 权限问题等，忽略 */
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install' && details.reason !== 'update') return;
  reconnectBridges();
});
