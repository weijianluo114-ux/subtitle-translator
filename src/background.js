'use strict';

/* 离线词典模块（纯函数 + 扩展源 IndexedDB + 分片下载），由 build 脚本产出的
 * src/data/dict-catalog.json 提供分片清单与 sha256。classic worker 用 importScripts 载入。 */
try {
  importScripts('dict.js');
} catch (e) {
  /* 载入失败只影响离线词典功能，翻译主流程不受影响 */
}

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
  constructor() {
    /* 免费匿名额度按 IP 计（约几千字符/天）。一旦命中额度上限，继续猛试只会让
     * 同一天内所有请求全部失败，所以这里做个熔断：额度耗尽后进入冷却期，
     * 期间直接失败并带上明确原因，让引擎链立刻去试别的引擎，而不是白等。 */
    this.quotaCooldownUntil = 0;
    this.quotaCooldownMs = 60 * 60 * 1000;   // 额度耗尽后冷却 1 小时
    this.lastError = null;
  }

  isQuotaExhausted() {
    return Date.now() < this.quotaCooldownUntil;
  }

  markQuotaExhausted() {
    this.quotaCooldownUntil = Date.now() + this.quotaCooldownMs;
  }

  async translate(text, sl, tl, signal) {
    if (this.isQuotaExhausted()) {
      const err = new Error('mymemory-quota-exhausted');
      err.quota = true;
      throw err;
    }
    const src = sl && sl !== 'auto' ? String(sl).split('-')[0] : 'autodetect';
    const tgt = tl || 'zh-CN';
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) +
      '&langpair=' + encodeURIComponent(src + '|' + tgt);
    const resp = await fetch(url, { signal });

    if (resp.status === 429) {
      this.markQuotaExhausted();
      const err = new Error('mymemory-quota-429');
      err.status = 429;
      err.quota = true;
      throw err;
    }
    if (!resp.ok) {
      const err = new Error('mymemory-http-' + resp.status);
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json();

    /* 额度用尽的两种表现形式：
     *   1) quotaFinished: true
     *   2) responseStatus: 429 / responseDetails 里含 "QUOTA" 或 "MYMEMORY WARNING" */
    const details = String((data && data.responseDetails) || '');
    if ((data && data.quotaFinished) || (data && data.responseStatus === 429) ||
        /quota|MYMEMORY WARNING|USED ALL AVAILABLE/i.test(details)) {
      this.markQuotaExhausted();
      const err = new Error('mymemory-quota-exhausted: ' + (details.slice(0, 120) || 'quotaFinished'));
      err.quota = true;
      throw err;
    }

    const translated = data && data.responseData && data.responseData.translatedText;
    if (!translated) throw new Error('mymemory-empty');

    /* MyMemory 有时把提示语当成译文返回（如 "MYMEMORY WARNING: YOU USED ALL AVAILABLE
     * FREE TRANSLATIONS FOR TODAY"），这种情况要当成失败而不是把英文提示显示给用户 */
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(translated)) {
      this.markQuotaExhausted();
      const err = new Error('mymemory-notice: ' + translated.slice(0, 100));
      err.quota = true;
      throw err;
    }

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


/* ============================ DeepL（用户自填 key，可选） ============================
 * DeepL Free 每月 50 万字符免费，质量优于 Google，且中国大陆可直连（无需代理）。
 * 需要用户在设置里粘贴一次 API key（形如 xxxx-xxxx-xxxx:fx，以 :fx 结尾的是 Free 端点）。
 * key 只存在本机 chrome.storage.local，不外传、不写日志。 */
class DeepLTranslator {
  constructor() {
    this.lastError = null;
  }

  /* Free key 以 ":fx" 结尾，必须走 api-free.deepl.com；Pro key 走 api.deepl.com */
  endpointFor(apiKey) {
    return /:fx$/.test(String(apiKey || '').trim())
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';
  }

  /* 语言代码转换：DeepL 用大写、且部分代码与 Google 不同（zh-CN → ZH-HANS 等） */
  static targetFor(code) {
    const c = String(code || '').toLowerCase();
    const map = {
      'zh': 'ZH', 'zh-cn': 'ZH-HANS', 'zh-tw': 'ZH-HANT', 'zh-hans': 'ZH-HANS', 'zh-hant': 'ZH-HANT',
      'en': 'EN-US', 'en-us': 'EN-US', 'en-gb': 'EN-GB', 'pt': 'PT-BR', 'pt-br': 'PT-BR',
      'pt-pt': 'PT-PT',
    };
    if (map[c]) return map[c];
    return c ? c.toUpperCase().split('-')[0] : 'ZH';
  }

  /* DeepL 不接受 'auto'；留空即自动检测 */
  static sourceFor(code) {
    const c = String(code || '').toLowerCase();
    if (!c || c === 'auto') return '';
    const map = { 'zh': 'ZH', 'zh-cn': 'ZH', 'zh-tw': 'ZH', 'en': 'EN', 'pt': 'PT' };
    if (map[c]) return map[c];
    return c.toUpperCase().split('-')[0];
  }

  async translate(text, sl, tl, signal, apiKey) {
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('deepl-no-key');

    const body = new URLSearchParams();
    body.set('text', text);
    body.set('target_lang', DeepLTranslator.targetFor(tl));
    const src = DeepLTranslator.sourceFor(sl);
    if (src) body.set('source_lang', src);
    /* tag_handling=html 会让 DeepL 解析标签，字幕是纯文本，保持默认即可 */

    const resp = await fetch(this.endpointFor(key), {
      method: 'POST',
      headers: {
        'Authorization': 'DeepL-Auth-Key ' + key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal,
    });

    if (resp.status === 403) throw new Error('deepl-auth-failed');
    if (resp.status === 429) throw new Error('deepl-quota-exceeded');
    if (resp.status === 456) throw new Error('deepl-quota-exceeded');   // DeepL 字符额度用尽专用码
    if (!resp.ok) {
      const err = new Error('deepl-http-' + resp.status);
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json();
    const list = data && data.translations;
    if (!Array.isArray(list) || !list.length) throw new Error('deepl-empty');

    let translated = '';
    for (const t of list) translated += (t && t.text) || '';

    return {
      translatedText: translated,
      detectedLanguageCode: (list[0] && list[0].detected_source_language) || '',
      dictionary: '',
      transliteration: '',
      transcription: '',
    };
  }
}

/* 自定义端点（用户自建代理，如 Cloudflare Worker），请求/响应格式见设置面板说明 */
class CustomEndpointTranslator {
  async translate(text, sl, tl, signal, endpoint) {
    const url = String(endpoint || '').trim();
    if (!url) throw new Error('custom-no-endpoint');
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source: sl || 'auto', target: tl || 'zh-CN' }),
      signal,
    });
    if (!resp.ok) throw new Error('custom-http-' + resp.status);
    const data = await resp.json();
    /* 兼容几种常见返回形态，尽量宽松，方便用户用自己的服务 */
    const translated = (data && (data.translatedText || data.translation || data.text ||
      (data.data && data.data.translatedText))) || '';
    if (!translated) throw new Error('custom-empty');
    return {
      translatedText: String(translated),
      detectedLanguageCode: (data && (data.detectedLanguageCode || data.detected_source_language)) || '',
      dictionary: '',
      transliteration: '',
      transcription: '',
    };
  }
}

const bing = new BingTranslator();

const google = new GoogleTranslator();
const mymemory = new MyMemoryTranslator();
const deepl = new DeepLTranslator();
const customEndpoint = new CustomEndpointTranslator();
const activeRequests = new Map();
let lastGoodEngine = null; // 仅用于诊断日志；实际避让已由下面的免费引擎冷却机制接管

/* ============================ 免费引擎冷却（避让重试） ============================
 * 背景：Google / Bing 免费且质量好，理应首选；但国内网络下 Google 常常是被限流状态，
 * 每句话都去试一遍会白白增加延迟。于是：
 *   失败一次 → 先让位给别的引擎，隔 N 句再回来试；连续失败则把间隔逐步拉长。
 *
 * 阶梯：10 句 → 15 句 → 20 句（封顶，之后固定每 20 句最多试一次）。
 * 一旦成功，立即清零：间隔回到 10 句重新开始。
 *
 * 计数器由页面侧持有（content script 与视频会话同生命周期），随每条翻译请求带上来，
 * 后台只负责「按计数过滤引擎 + 计算新的计数并回传」。这样 service worker 被回收
 * 也不会丢掉冷却状态。
 * ================================================================================= */
const FREE_ENGINES = ['google', 'bing'];
const FREE_ENGINE_COOLDOWN_STEPS = [10, 15, 20];   // 第 1/2/3+ 次连续失败后的等待句数

function normalizeCooldownMap(raw) {
  const out = {};
  for (const k of FREE_ENGINES) {
    const v = raw && raw[k];
    const n = Number(v);
    out[k] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return out;
}

function normalizeLevelMap(raw) {
  const out = {};
  for (const k of FREE_ENGINES) {
    const v = raw && raw[k];
    const n = Number(v);
    out[k] = Number.isFinite(n) && n > 0 ? Math.min(3, Math.floor(n)) : 0;
  }
  return out;
}

/* 连续失败 n 次后应等待的句数（n=0 表示不等待） */
/* 轻量日志：只在 service worker 控制台可见，不写入诊断报告 */
function swLog(...args) {
  try { console.log('[kt-engine]', ...args); } catch (e) { /* ignore */ }
}

function cooldownForLevel(level) {
  if (level <= 0) return 0;
  const idx = Math.min(level - 1, FREE_ENGINE_COOLDOWN_STEPS.length - 1);
  return FREE_ENGINE_COOLDOWN_STEPS[idx];
}

/* DeepL key / 自定义端点：从 storage 读一次并跟随变化更新，
 * 避免每次翻译都读取 storage（service worker 里读 storage 是异步的，会拖慢首包）。 */
let storedDeepLKey = '';
let storedCustomEndpoint = '';

function refreshTranslatorConfig() {
  try {
    chrome.storage.local.get({ ktSettings: null }, (items) => {
      if (chrome.runtime.lastError) return;
      const s = (items && items.ktSettings) || {};
      storedDeepLKey = typeof s.deeplKey === 'string' ? s.deeplKey : '';
      storedCustomEndpoint = typeof s.customEndpoint === 'string' ? s.customEndpoint : '';
      /* 配置变了就清掉"上次成功引擎"的记忆，否则会一直卡在已经不存在的引擎上 */
      if (storedDeepLKey === '' && lastGoodEngine === 'deepl') lastGoodEngine = null;
      if (storedCustomEndpoint === '' && lastGoodEngine === 'custom') lastGoodEngine = null;
    });
  } catch (e) { /* ignore */ }
}

refreshTranslatorConfig();

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.ktSettings) return;
    const s = changes.ktSettings.newValue || {};
    storedDeepLKey = typeof s.deeplKey === 'string' ? s.deeplKey : '';
    storedCustomEndpoint = typeof s.customEndpoint === 'string' ? s.customEndpoint : '';
  });
} catch (e) { /* ignore */ }

/* ============================ 离线音标词典（内置，纯本地，不联网） ============================
 * 数据：CMUdict（BSD-2-Clause）经 tools/make_ipa_dict.py 转成的美式 IPA，见 src/data/ipa-en.tsv。
 * 首次查询时懒加载并解析成 Map，之后常驻（service worker 生命周期内）。 */
const IPA_DICT_PATH = 'data/ipa-en.tsv';
let ipaDict = null;
let ipaDictLoading = null;

function parseIpaTsv(text) {
  const map = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line || line.charCodeAt(0) === 35 /* # 注释行 */) continue;
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const word = line.slice(0, tab);
    const ipas = line.slice(tab + 1).split(';').filter(Boolean);
    if (ipas.length) map.set(word, ipas);
  }
  return map;
}

/* 归一化：小写 + 去掉首尾非字母 */
function ipaLookupKey(rawWord) {
  return String(rawWord || '')
    .toLowerCase()
    .replace(/^[^a-z]+/, '')
    .replace(/[^a-z'\-]+$/, '');
}

/* 查表：原词 → 去所有格/缩写 → 去连字符 → 连字符末段，依次回退 */
function lookupIpa(map, rawWord) {
  const w = ipaLookupKey(rawWord);
  if (!w || !map || !map.size) return [];
  if (map.has(w)) return map.get(w);
  const stripped = w.replace(/['’](s|re|ve|ll|d|m|t)$/, '');
  if (stripped && stripped !== w && map.has(stripped)) return map.get(stripped);
  const noHyphen = w.replace(/-/g, '');
  if (noHyphen !== w && map.has(noHyphen)) return map.get(noHyphen);
  const last = w.split('-').pop();
  if (last && last !== w && map.has(last)) return map.get(last);
  return [];
}

async function loadIpaDict() {
  if (ipaDict) return ipaDict;
  if (!ipaDictLoading) {
    ipaDictLoading = (async () => {
      try {
        const resp = await fetch(chrome.runtime.getURL(IPA_DICT_PATH));
        ipaDict = parseIpaTsv(await resp.text());
      } catch (e) {
        ipaDict = new Map(); // 读取失败只影响音标显示，不影响翻译等其它功能
      }
      return ipaDict;
    })();
  }
  return ipaDictLoading;
}

/* ---------------------------------------------------------------- 安装进度端口
 * 下载 32 个分片要几十秒，sendResponse 只能回一次，所以进度走长连接端口：
 * 弹窗 connect({ name: 'kt-dict-progress' }) → postMessage({ dictId, mirror })，
 * 后台逐片 postMessage({ type:'progress' | 'done' | 'error', ... })。 */
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'kt-dict-progress') return;
  let started = false;

  port.onDisconnect.addListener(() => { started = false; });

  port.onMessage.addListener((msg) => {
    const dict = globalThis.__ktDict;
    if (started) return;                       // 一次连接只跑一次安装
    if (!dict) {
      port.postMessage({ type: 'error', error: 'dict module unavailable' });
      return;
    }
    const dictId = String((msg && msg.dictId) || '');
    if (!dictId) {
      port.postMessage({ type: 'error', error: 'missing dictId' });
      return;
    }
    started = true;
    let lastSentAt = 0;

    dict.installDict(dictId, {
      mirror: typeof (msg && msg.mirror) === 'string' ? msg.mirror : '',
      force: !!(msg && msg.force),
      onProgress: (p) => {
        const now = Date.now();
        const isFinal = p.done >= p.total;
        if (!isFinal && now - lastSentAt < 120) return;   // 节流，避免端口消息刷屏
        lastSentAt = now;
        try { port.postMessage({ type: 'progress', progress: p }); } catch (e) { /* 页面已关 */ }
      },
    })
      .then((result) => {
        try { port.postMessage({ type: 'done', result }); } catch (e) { /* 页面已关 */ }
      })
      .catch((e) => {
        try { port.postMessage({ type: 'error', error: String((e && e.message) || e) }); } catch (e2) { /* 页面已关 */ }
      });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  /* ---------------------------------------------------------------- 离线词典
   * 动作集合（都来自 storage-bridge 的转发，页面侧不直接调用）：
   *   kt-dict-status   → 已安装的词典元信息
   *   kt-dict-lookup   → 查一个词（只用已安装词典）
   *   kt-dict-install  → 下载并安装（逐片回传进度）
   *   kt-dict-remove   → 删除某个词典的所有分片
   *   kt-dict-catalog  → 清单（含体积、条目数、许可）
   * 下载会跑很久，必须 return true 保持消息通道打开。 */
  if (message.action === 'kt-dict') {
    const dict = globalThis.__ktDict;
    if (!dict) {
      sendResponse({ ok: false, error: 'dict module unavailable' });
      return false;
    }
    const op = String(message.op || '');
    const dictId = String(message.dictId || '');

    if (op === 'status') {
      dict.dictStatus()
        .then((installed) => sendResponse({ ok: true, installed }))
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    }

    if (op === 'catalog') {
      dict.loadCatalog()
        .then((catalog) => sendResponse({
          ok: true,
          cdn: catalog.cdn,
          version: catalog.version,
          buckets: catalog.buckets,
          dicts: catalog.dicts,
        }))
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    }

    if (op === 'lookup') {
      dict.lookup(String(message.word || ''))
        .then((hit) => sendResponse(hit))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (op === 'install') {
      /* 一次性触发安装（不关心进度时的入口）；进度请走 kt-dict-progress 端口 */
      dict.installDict(dictId, { mirror: typeof message.mirror === 'string' ? message.mirror : '' })
        .then((result) => sendResponse(Object.assign({ ok: true }, result)))
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    }

    if (op === 'remove') {
      dict.removeDict(dictId)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    }

    sendResponse({ ok: false, error: 'unknown op: ' + op });
    return false;
  }


  /* 离线音标查询：纯本地查表，不发任何网络请求 */
  if (message.action === 'kt-ipa-lookup') {
    const words = Array.isArray(message.words) ? message.words.slice(0, 200) : [];
    loadIpaDict()
      .then((map) => {
        const ipa = {};
        for (const w of words) {
          const hit = lookupIpa(map, w);
          if (hit.length) ipa[String(w)] = hit.slice(0, 4);
        }
        sendResponse({ ok: true, ipa, size: map.size });
      })
      .catch(() => sendResponse({ ok: false, ipa: {} }));
    return true; // 异步响应
  }

  if (message.action === 'translate') {
    const controller = new AbortController();
    activeRequests.set(message.requestId, controller);
    const all = { google, bing, mymemory, deepl, custom: customEndpoint };
    const primaryKey = ['bing', 'mymemory', 'deepl', 'custom'].includes(message.translatorKey)
      ? message.translatorKey : 'google';

    /* 只有配置了才把 deepL / custom 放进候选链，避免每次翻译都白试一个必然失败的引擎 */
    const configured = {
      deepl: !!String(storedDeepLKey || '').trim(),
      custom: !!String(storedCustomEndpoint || '').trim(),
    };

    /* 页面侧带上的冷却状态：cooldown = 还要等几句才允许再试该引擎，level = 连续失败次数 */
    const cdIn = normalizeCooldownMap(message.freeCooldown);
    const lvIn = normalizeLevelMap(message.freeFailLevel);

    /* 参与本句话冷却计数的免费引擎（用户首选若不是免费引擎，两个免费引擎都算候选） */
    const freeCandidates = FREE_ENGINES.filter((k) => {
      if (cdIn[k] > 0) return false;              // 还在冷却期，本句不参与
      return true;
    });

    /* 冷却计数每句话减 1；用"减完之后"的值判断：
     * cooldown=10 表示跳过接下来的 10 句，第 11 句才回来试。 */
    const cdNext = {};
    for (const k of FREE_ENGINES) cdNext[k] = Math.max(0, cdIn[k] - 1);
    const cooledFree = (k) => FREE_ENGINES.includes(k) && cdNext[k] > 0;

    /* 引擎顺序：用户首选 > 其余免费引擎 > 已配置的 DeepL > 已配置的自定义 > MyMemory
     *  - 免费引擎在冷却期内会被整体跳过（cooledFree），不再每句白试
     *  - MyMemory 放最后（匿名额度最小，且额度耗尽会熔断）
     *  - 不再让 lastGoodEngine 插队，避免"我选 Google 却一直在用 MyMemory" */
    const order = [primaryKey, 'google', 'bing', 'deepl', 'custom', 'mymemory']
      .filter((k) => k && all[k])
      .filter((k) => !cooledFree(k))
      .filter((k) => k !== 'deepl' || configured.deepl)
      .filter((k) => k !== 'custom' || configured.custom)
      .filter((k, i, arr) => arr.indexOf(k) === i);

    const lvNext = { ...lvIn };
    const triedFree = [];

    (async () => {
      const errors = [];
      for (const key of order) {
        if (FREE_ENGINES.includes(key)) triedFree.push(key);
        try {
          const extra = key === 'deepl' ? storedDeepLKey
            : key === 'custom' ? storedCustomEndpoint : undefined;
          const r = await all[key].translate(message.text, message.sourceLanguageCode,
            message.targetLanguageCode, controller.signal, extra);
          lastGoodEngine = key;
          /* 成功：本句实际试过的免费引擎全部清零（间隔回到 10 句重新起步） */
          /* 只清零真正成功的那一个引擎。
           * 本句里失败过的免费引擎（例如 Google 失败后由 Bing 接手）必须保留
           * 它的冷却与等级，否则一成功就把失败记录抹掉，等于永远不冷却。 */
          if (FREE_ENGINES.includes(key)) { cdNext[key] = 0; lvNext[key] = 0; }
          swLog('ok', key, '| cooldown', JSON.stringify(cdNext), '| level', JSON.stringify(lvNext));
          sendResponse({
            translatedText: r.translatedText,
            detectedLanguageCode: r.detectedLanguageCode,
            dictionary: r.dictionary,
            transliteration: r.transliteration,
            transcription: r.transcription,
            engine: key,
            freeCooldown: cdNext,
            freeFailLevel: lvNext,
          });
          return;
        } catch (err) {
          errors.push(key + ': ' + String((err && err.message) || err));
          /* 免费引擎失败：升一级并进入阶梯冷却（10 → 15 → 20 句后再试） */
          if (FREE_ENGINES.includes(key)) {
            lvNext[key] = Math.min(3, (lvNext[key] || 0) + 1);
            cdNext[key] = cooldownForLevel(lvNext[key]);
          }
          if (controller.signal.aborted) break;
        }
      }
      swLog('failed', '| tried', JSON.stringify(triedFree), '| cooldown', JSON.stringify(cdNext), '| level', JSON.stringify(lvNext));
      sendResponse({
        error: errors.join(' | '),
        freeCooldown: cdNext,
        freeFailLevel: lvNext,
      });
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
