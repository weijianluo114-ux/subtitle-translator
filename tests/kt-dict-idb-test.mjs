
/* 离线词典 IndexedDB 升级回归测试
 * 运行：node tests/kt-dict-idb-test.mjs
 *
 * 复现并回归 Bug：旧 v1 库只有 shards、缺 meta → 一写元信息就报
 * "One of the specified object stores was not found"。运行：node log/dict/test-idb-upgrade.mjs */

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = process.cwd();

/* 可配置的假 IndexedDB：支持版本升级与 onupgradeneeded，用来模拟"历史库缺 store" */
function makeFakeIdb(initial) {
  const state = { version: initial.version, stores: new Map() };
  for (const name of initial.stores) state.stores.set(name, new Map());

  function makeDb() {
    return {
      get version() { return state.version; },
      objectStoreNames: {
        contains: (name) => state.stores.has(name),
        [Symbol.iterator]: () => state.stores.keys(),
      },
      createObjectStore(name) {
        if (!state.stores.has(name)) state.stores.set(name, new Map());
        return { name };
      },
      close() {},
      transaction(name) {
        if (!state.stores.has(name)) {
          throw new Error("Failed to execute 'transaction' on 'IDBDatabase': One of the specified object stores was not found.");
        }
        const store = state.stores.get(name);
        const ops = [];
        const tx = { oncomplete: null, onerror: null, error: null };
        tx.objectStore = () => ({
          get(k) { const r = {}; ops.push(() => { r.result = store.get(k); if (r.onsuccess) r.onsuccess(); }); return r; },
          getAllKeys() { const r = {}; ops.push(() => { r.result = [...store.keys()]; if (r.onsuccess) r.onsuccess(); }); return r; },
          put(v, k) { ops.push(() => store.set(k, v)); return {}; },
          delete(k) { ops.push(() => store.delete(k)); return {}; },
        });
        setTimeout(() => {
          for (const op of ops) op();
          if (tx.oncomplete) tx.oncomplete();
        }, 0);
        return tx;
      },
    };
  }

  return {
    state,
    open(name, version) {
      const req = {};
      setTimeout(() => {
        const requested = version == null ? state.version : version;
        if (requested > state.version) {
          const oldVersion = state.version;
          state.version = requested;
          const db = makeDb();
          req.result = db;
          if (req.onupgradeneeded) {
            req.onupgradeneeded({ oldVersion, newVersion: requested, target: { result: db } });
          }
          if (req.onsuccess) req.onsuccess();
          return;
        }
        req.result = makeDb();
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
}

const loadDict = (idb) => {
  const ctx = vm.createContext({
    console, Blob, Response, DecompressionStream,
    crypto: { subtle: globalThis.crypto.subtle },
    indexedDB: idb,
    fetch: async () => { throw new Error('no-net'); },
    chrome: { runtime: { getURL: (p) => p } },
  });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/dict.js'), 'utf8'), ctx);
  return ctx.__ktDict;
};

let failed = 0;
const assert = (cond, msg) => {
  if (cond) console.log('PASS:', msg);
  else { console.error('FAIL:', msg); failed++; }
};

/* ---- 场景 A：全新安装（库不存在 → 从 0 升到 DB_VERSION）---- */
const fresh = makeFakeIdb({ version: 0, stores: [] });
const freshApi = loadDict(fresh);
await freshApi.ensureStores();
assert(fresh.state.stores.has('shards') && fresh.state.stores.has('meta'),
  '全新安装后 shards 与 meta 两个 store 都创建');
assert(fresh.state.version >= 2, '全新安装的库版本 >= 2，got ' + fresh.state.version);

/* ---- 场景 B：历史 v1 库（只有 shards，缺 meta）→ 必须能自愈 ---- */
const legacy = makeFakeIdb({ version: 1, stores: ['shards'] });
const legacyApi = loadDict(legacy);

/* 先证明这个历史库确实会复现原始 bug */
legacy.state.stores.get('shards').set('ecdict:00', { text: 'a\tb' });
let reproduced = false;
try {
  const db = await new Promise((res, rej) => {
    const req = legacy.open('kt-dict', 1);
    setTimeout(() => {
      try { res(req.result); } catch (e) { rej(e); }
    }, 5);
  });
  db.transaction('meta');
} catch (e) {
  reproduced = /object stores was not found/i.test(String(e && e.message));
}
assert(reproduced, '历史 v1 库（缺 meta）确实复现原始报错：One of the specified object stores was not found');

/* 用真实 dict.js 打开同一个历史库，应当自动补齐 meta */
await legacyApi.ensureStores();
assert(legacy.state.stores.has('meta'), '旧 v1 库经 dict.js 打开后自动补齐 meta store');
assert(legacy.state.stores.has('shards'), '旧 v1 库的 shards 仍然存在（已下载分片不丢失）');
assert(legacy.state.stores.get('shards').has('ecdict:00'), '旧 v1 库已下载的分片内容保留，未被打包清除');
assert(legacy.state.version >= 2, '旧库版本被升到 >= 2，got ' + legacy.state.version);

/* 升级后可正常读元信息 */
const status = await legacyApi.dictStatus();
assert(typeof status === 'object', '升级后 dictStatus 可正常读取（meta store 可用）');

/* ---- 场景 C：安装流程在缺 store 时必须 fail-fast（不能白下 32 片）---- */
const broken = makeFakeIdb({ version: 1, stores: ['shards'] });
/* 制造"自愈也失败"的局面：升级被 blocked */
let installError = null;
const brokenApi = loadDict({
  open() {
    const req = {};
    setTimeout(() => {
      req.result = null;
      if (req.onerror) req.onerror({ target: { error: new Error('upgrade blocked') } });
    }, 0);
    return req;
  },
});
try {
  await brokenApi.installDict('wordnet', { catalog: { dicts: { wordnet: { shards: {} } } } });
} catch (e) {
  installError = e;
}
assert(!!installError && !/no init\/shard/i.test(String(installError.message)),
  'store 不可用时安装立即失败，错误信息明确（got: ' + (installError && installError.message) + '）');

console.log('\n==== ' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED') + ' ====');
process.exit(failed === 0 ? 0 : 1);
