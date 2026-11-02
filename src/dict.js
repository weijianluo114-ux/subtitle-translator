/* 离线词典：共享模块（纯函数 + 扩展源 IndexedDB + 分片下载）
 *
 * 由 background.js 用 importScripts('dict.js') 载入（service worker 是 classic worker）。
 * 不放在 content script 里跑的两个硬原因：
 *   1. content script 的 IndexedDB 属于页面源（youtube.com），与扩展源不共享，
 *      卸载扩展后也不会被清理 —— 必须存在扩展源（service worker 里）。
 *   2. 下载需要 host_permissions 覆盖 cdn.jsdelivr.net，且不受页面 CSP 影响。
 *
 * 词典包格式（由 tools/build_dicts.py 生成，托管在仓库 dict-v1 分支）：
 *   <bucket>.tsv.gz   gzip 压缩 TSV，每行 "key<TAB>body"（key 已小写）
 *   bucket            = fnv1a(key) % 32，两位十六进制
 *   清单              src/data/dict-catalog.json（含每个分片 sha256）
 *
 * 页面侧只通过 storage-bridge 转发消息，不直接碰这里。
 */
(() => {
  'use strict';

  const BUCKETS = 32;
  const DB_NAME = 'kt-dict';
  const DB_VERSION = 1;
  const STORE_SHARDS = 'shards';
  const STORE_META = 'meta';

  const DEFAULT_CDN = 'https://cdn.jsdelivr.net/gh/weijianluo114-ux/subtitle-translator@dict-v1/dicts';
  const FALLBACK_CDN = 'https://raw.githubusercontent.com/weijianluo114-ux/subtitle-translator/dict-v1/dicts';

  /* ------------------------------------------------------------------ 哈希 */

  /* FNV-1a，逐 UTF-16 码元（与 tools/build_dicts.py 的 key_hash 完全一致）。
   * 必须用 Math.imul：h * 0x01000193 超过 2^53，普通乘法会丢精度导致两边结果不同。 */
  function keyHash(text) {
    const s = String(text == null ? '' : text);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h = (h ^ (s.charCodeAt(i) & 0xffff)) >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function bucketOf(key) {
    return ('0' + (keyHash(key) % BUCKETS).toString(16)).slice(-2);
  }

  /* 查表归一化：小写 → 去首尾非字母 → 所有格/缩写回退 → 连字符回退 */
  function normalizeKey(rawWord) {
    return String(rawWord == null ? '' : rawWord)
      .toLowerCase()
      .replace(/^[^a-z\u00c0-\u024f]+/, '')
      .replace(/[^a-z\u00c0-\u024f'\-]+$/, '');
  }

  function candidateKeys(rawWord) {
    const base = normalizeKey(rawWord);
    if (!base) return [];
    const out = [base];
    const stripped = base.replace(/['\u2019](s|re|ve|ll|d|m|t)$/, '');
    if (stripped && stripped !== base) out.push(stripped);
    const noHyphen = base.replace(/-/g, '');
    if (noHyphen !== base) out.push(noHyphen);
    const last = base.split('-').pop();
    if (last && last !== base) out.push(last);
    return out.filter((k, i, arr) => k && arr.indexOf(k) === i);
  }

  /* ---------------------------------------------------------- gzip / 校验 */

  async function gunzip(buffer) {
    if (typeof DecompressionStream !== 'function') throw new Error('DecompressionStream unavailable');
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* ------------------------------------------------------------- IndexedDB */

  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SHARDS)) db.createObjectStore(STORE_SHARDS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    });
    return dbPromise;
  }

  function idbGet(store, key) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  function idbPut(store, key, value) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    }));
  }

  function idbDelete(store, key) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    }));
  }

  function idbKeys(store) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAllKeys();
      req.onsuccess = () => resolve((req.result || []).map(String));
      req.onerror = () => reject(req.error);
    }));
  }

  /* ----------------------------------------------------------- 分片解析 */

  function shardId(dictId, bucket) {
    return dictId + ':' + bucket;
  }

  function parseTsv(text) {
    const map = new Map();
    for (const row of String(text || '').split('\n')) {
      if (!row) continue;
      const tab = row.indexOf('\t');
      if (tab <= 0) continue;
      map.set(row.slice(0, tab), row.slice(tab + 1));
    }
    return map;
  }

  /* 已解析分片的内存缓存（LRU）。service worker 被回收后会自动重建。 */
  const shardCache = new Map();
  const SHARD_CACHE_MAX = 8;

  async function loadShardMap(dictId, bucket) {
    const id = shardId(dictId, bucket);
    if (shardCache.has(id)) {
      const hit = shardCache.get(id);
      shardCache.delete(id);
      shardCache.set(id, hit);
      return hit;
    }
    const record = await idbGet(STORE_SHARDS, id);
    if (!record || !record.text) return null;
    const map = parseTsv(record.text);
    shardCache.set(id, map);
    if (shardCache.size > SHARD_CACHE_MAX) shardCache.delete(shardCache.keys().next().value);
    return map;
  }

  /* 单词典查询：命中返回 { dictId, key, body }；分片没下载或没词条返回 null */
  async function lookupInDict(dictId, rawWord) {
    for (const key of candidateKeys(rawWord)) {
      let map = null;
      try {
        map = await loadShardMap(dictId, bucketOf(key));
      } catch (e) {
        map = null;
      }
      if (!map) continue;
      const body = map.get(key);
      if (body) return { dictId, key, body: String(body) };
    }
    return null;
  }

  /* ------------------------------------------------------------- 词典管理 */

  async function dictStatus() {
    const out = {};
    try {
      for (const key of await idbKeys(STORE_META)) {
        if (key === 'catalog') continue;
        const meta = await idbGet(STORE_META, key);
        if (meta && meta.installed) out[key] = meta;
      }
    } catch (e) { /* IDB 不可用就当没装 */ }
    return out;
  }

  async function removeDict(dictId) {
    for (const key of await idbKeys(STORE_SHARDS)) {
      if (key.indexOf(dictId + ':') === 0) {
        await idbDelete(STORE_SHARDS, key);
        shardCache.delete(key);
      }
    }
    await idbDelete(STORE_META, dictId);
    return true;
  }

  /* ---------------------------------------------------------- 清单 / 下载 */

  let catalogCache = null;
  async function loadCatalog() {
    if (catalogCache) return catalogCache;
    const resp = await fetch(chrome.runtime.getURL('data/dict-catalog.json'));
    if (!resp.ok) throw new Error('catalog-http-' + resp.status);
    catalogCache = await resp.json();
    return catalogCache;
  }

  /* 拉取单个分片：默认先 CDN，失败退 raw.githubusercontent */
  async function fetchShard(baseUrl, dictId, bucket) {
    const path = '/' + dictId + '/' + bucket + '.tsv.gz';
    const urls = baseUrl && baseUrl !== DEFAULT_CDN
      ? [baseUrl.replace(/\/$/, '') + path]
      : [DEFAULT_CDN + path, FALLBACK_CDN + path];
    let lastErr = null;
    for (const url of urls) {
      try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error('http-' + resp.status);
        return await resp.arrayBuffer();
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error('shard fetch failed: ' + dictId + '/' + bucket + ' (' + String((lastErr && lastErr.message) || lastErr) + ')');
  }

  /* 安装：逐片下载 → 校验 sha256 → 解压 → 写 IDB。
   * 已存在且校验通过的分片跳过，因此中断后再点下载可续传。 */
  async function installDict(dictId, options) {
    const opts = options || {};
    const catalog = opts.catalog || await loadCatalog();
    const info = catalog && catalog.dicts && catalog.dicts[dictId];
    if (!info) throw new Error('unknown dict: ' + dictId);
    const buckets = Object.keys(info.shards || {}).sort();
    const total = buckets.length;
    /* force=true 时先清空已有分片，真正重新下载（弹窗「重新下载」用） */
    if (opts.force) await removeDict(dictId);
    let done = 0;
    let bytes = 0;
    const report = () => {
      if (typeof opts.onProgress === 'function') {
        opts.onProgress({ dictId, done, total, bytes, bytesTotal: info.bytes || 0 });
      }
    };
    report();

    for (const bucket of buckets) {
      const expectSha = (info.shards[bucket] || {}).sha256 || '';
      const existing = await idbGet(STORE_SHARDS, shardId(dictId, bucket));
      if (existing && existing.text && (!expectSha || existing.sha256 === expectSha)) {
        done++;
        bytes += existing.bytes || 0;
        report();
        continue;
      }
      const buf = await fetchShard(opts.mirror, dictId, bucket);
      const sha = await sha256Hex(buf);
      if (expectSha && sha !== expectSha) throw new Error('sha256 mismatch: ' + dictId + '/' + bucket);
      const text = await gunzip(buf);
      await idbPut(STORE_SHARDS, shardId(dictId, bucket), {
        text, bytes: buf.byteLength || 0, sha256: sha, at: Date.now(),
      });
      shardCache.delete(shardId(dictId, bucket));
      done++;
      bytes += buf.byteLength || 0;
      report();
    }

    await idbPut(STORE_META, dictId, {
      installed: true,
      entries: info.entries || 0,
      bytes: info.bytes || 0,
      shards: total,
      license: info.license || '',
      name: info.name || dictId,
      at: Date.now(),
    });
    return { ok: true, dictId, entries: info.entries || 0, bytes: info.bytes || 0, shards: total };
  }

  /* 词条语言：含 CJK 走汉英词典，否则走英汉/英英 */
  const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

  function dictOrderFor(word) {
    return CJK_RE.test(String(word || '')) ? ['cedict'] : ['ecdict', 'wordnet'];
  }

  /* 组合查询：按语言选词典顺序，只用已安装的词典 */
  async function lookup(word) {
    const status = await dictStatus();
    for (const dictId of dictOrderFor(word)) {
      if (!status[dictId]) continue;
      const hit = await lookupInDict(dictId, word);
      if (hit) {
        return {
          ok: true,
          dictId: hit.dictId,
          key: hit.key,
          body: hit.body,
          license: status[hit.dictId].license || '',
        };
      }
    }
    return { ok: false };
  }

  const api = {
    BUCKETS, DEFAULT_CDN, FALLBACK_CDN, CJK_RE,
    keyHash, bucketOf, normalizeKey, candidateKeys,
    gunzip, sha256Hex, parseTsv,
    loadShardMap, lookupInDict, lookup, dictOrderFor,
    dictStatus, removeDict,
    loadCatalog, installDict,
  };

  globalThis.__ktDict = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
