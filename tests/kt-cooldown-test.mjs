
/* 免费引擎冷却（避让重试）回归测试
 * 运行：测试脚本内联验证后台引擎链的冷却行为
 *
 * 用户需求：Google / Bing 免费所以要首选；但失败后先换别的引擎，
 * 隔 N 句再回来试；阶梯 10 → 15 → 20 句，封顶每 20 句最多试一次。
 */
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url);
const bgCode = fs.readFileSync(new URL('src/background.js', ROOT), 'utf8');

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); failed++; } else console.log('PASS:', msg);
};

/* ---------- 构造后台上下文，fetch 可编程，记录每次被调用的引擎 ---------- */
function makeBg(behavior) {
  let listener = null;
  const calls = [];
  const ctx = vm.createContext({
    console: { log: () => {} },
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    Blob, Response, DecompressionStream,
    crypto: globalThis.crypto,
    indexedDB: undefined,
    importScripts: () => {},
    fetch: async (url, opts) => {
      const u = String(url);

      /* Bing 需要两步：先抓 translator 页面拿 IG / params_AbusePreventionHelper 凭据，
       * 再 POST ttranslatev3。测试桩必须还原这个流程，否则 Bing 会直接失败。 */
      const isBingPage = u.includes('www.bing.com/translator');
      const isBingTranslate = u.includes('ttranslatev3');
      let engine = 'unknown';
      if (u.includes('translate.googleapis.com') || u.includes('translate.google.com')) engine = 'google';
      else if (isBingPage || isBingTranslate) engine = 'bing';
      else if (u.includes('mymemory')) engine = 'mymemory';
      else if (u.includes('deepl')) engine = 'deepl';
      else if (u.includes('example.com')) engine = 'custom';

      if (isBingPage) {
        /* 拿凭据的页面请求不计入翻译尝试次数，但失败也必须让 Bing 整体失败 */
        const okPage = behavior('bing');
        if (!okPage) {
          return { ok: false, status: 500, text: async () => '', json: async () => ({}) };
        }
        const html = '<html><script>IG:"ABC123XYZ"</script>' +
          '<div data-iid="translator.5023"></div>' +
          '<script>params_AbusePreventionHelper = [123456789, "tok-abc", 3600000];</script></html>';
        return { ok: true, status: 200, text: async () => html, json: async () => ({}) };
      }

      calls.push(engine);
      const ok = behavior(engine);
      if (!ok) return { ok: false, status: 500, json: async () => ({}), text: async () => 'fail' };

      if (engine === 'google') {
        return { ok: true, status: 200, json: async () => ({ sentences: [{ trans: '你好' }] }), text: async () => '' };
      }
      if (engine === 'bing') {
        /* 真实 Bing 返回数组：[{ detectedLanguage, translations:[{ text }] }] */
        return {
          ok: true, status: 200, text: async () => '',
          json: async () => ([{ detectedLanguage: { language: 'en' }, translations: [{ text: '你好' }] }]),
        };
      }
      if (engine === 'mymemory') {
        return { ok: true, status: 200, json: async () => ({ responseData: { translatedText: '你好' }, responseStatus: 200, quotaFinished: false }), text: async () => '' };
      }
      return { ok: true, status: 200, json: async () => ({ translations: [{ text: '你好' }] }), text: async () => '' };
    },
    chrome: {
      runtime: {
        getURL: (p) => p,
        onMessage: { addListener: (fn) => { listener = fn; } },
        onConnect: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        lastError: null,
      },
      tabs: { query: async () => [] },
      scripting: { executeScript: async () => {} },
      storage: {
        local: { get: (d, cb) => cb && cb({ ktSettings: null }), set: () => {} },
        onChanged: { addListener: () => {} },
      },
    },
  });
  ctx.globalThis = ctx;
  vm.runInContext(bgCode, ctx);
  return { ctx, calls, translate: (msg) => new Promise((res) => listener({
    action: 'translate', requestId: 'r' + Math.random(), text: 'hello',
    translatorKey: 'google', sourceLanguageCode: 'en', targetLanguageCode: 'zh-CN',
    ...msg,
  }, {}, res)) };
}

/* ---------- 1. 阶梯常量 ---------- */
console.log('\n-- 冷却阶梯 --');
const bg = makeBg(() => true);
const cooldownForLevel = vm.runInContext('cooldownForLevel', bg.ctx);
assert(cooldownForLevel(0) === 0, '连续失败 0 次 → 不冷却');
assert(cooldownForLevel(1) === 10, '第 1 次失败 → 等 10 句');
assert(cooldownForLevel(2) === 15, '第 2 次失败 → 等 15 句');
assert(cooldownForLevel(3) === 20, '第 3 次失败 → 等 20 句（封顶）');
assert(cooldownForLevel(9) === 20, '第 9 次失败仍是 20 句（上限锁死）');

/* ---------- 2. Google 失败 → 立刻让位给 Bing，且回传冷却 ---------- */
console.log('\n-- Google 失败后让位 --');
const bg1 = makeBg((engine) => engine !== 'google');
const res1 = await bg1.translate({ freeCooldown: { google: 0, bing: 0 }, freeFailLevel: { google: 0, bing: 0 } });
assert(res1.engine === 'bing', 'Google 失败后本句由 Bing 接管（got ' + res1.engine + '）');
assert(res1.freeCooldown.google === 10, 'Google 进入 10 句冷却（got ' + res1.freeCooldown.google + '）');
assert(res1.freeFailLevel.google === 1, 'Google 连续失败等级 = 1');
assert(res1.freeCooldown.bing === 0, 'Bing 成功，冷却清零');
assert(!bg1.calls.includes('mymemory'), 'Google 失败后没有越级去用 MyMemory');

/* ---------- 3. 冷却期内完全不试 Google ---------- */
console.log('\n-- 冷却期内跳过 Google --');
const bg2 = makeBg((engine) => engine !== 'google');
const res2 = await bg2.translate({ freeCooldown: { google: 5, bing: 0 }, freeFailLevel: { google: 1, bing: 0 } });
assert(!bg2.calls.includes('google'), '冷却期内后台完全不尝试 Google（calls: ' + bg2.calls.join(',') + '）');
assert(res2.freeCooldown.google === 4, '每句话把等待额度减 1（5 → ' + res2.freeCooldown.google + '）');
assert(res2.engine === 'bing', '冷却期内由 Bing 接管');

/* ---------- 4. 冷却归零后重新尝试 Google ----------
 * cooldown=1 表示"跳过 1 句"，后台先减 1 变 0，所以本句就允许尝试。 */
console.log('\n-- 冷却结束回到 Google --');
const bg3 = makeBg(() => true);
const res3 = await bg3.translate({ freeCooldown: { google: 1, bing: 0 }, freeFailLevel: { google: 1, bing: 0 } });
assert(bg3.calls.includes('google'), '最后 1 句等待走完后重新尝试 Google（calls: ' + bg3.calls.join(',') + '）');
assert(res3.engine === 'google', 'Google 恢复后重新成为实际使用的引擎');
assert(res3.freeCooldown.google === 0 && res3.freeFailLevel.google === 0, '成功一次后等级与冷却都清零（下次失败从 10 句重新开始）');

/* ---------- 5. 连续失败使间隔逐步拉长 ---------- */
console.log('\n-- 连续失败阶梯递增 --');
const bg4 = makeBg((engine) => engine !== 'google' && engine !== 'bing' && engine !== 'mymemory');
let state = { freeCooldown: { google: 0, bing: 0 }, freeFailLevel: { google: 0, bing: 0 } };
const ladder = [];
for (let i = 0; i < 4; i++) {
  /* 每次把 Google 的冷却清掉，模拟"已经等够了又回来试" */
  const r = await bg4.translate({ freeCooldown: { google: 0, bing: 0 }, freeFailLevel: state.freeFailLevel });
  ladder.push({ level: r.freeFailLevel.google, wait: r.freeCooldown.google });
  state = { freeFailLevel: r.freeFailLevel };
}
assert(ladder[0].wait === 10 && ladder[0].level === 1, '第 1 次失败 → 等 10 句（got ' + JSON.stringify(ladder[0]) + '）');
assert(ladder[1].wait === 15 && ladder[1].level === 2, '第 2 次失败 → 等 15 句（got ' + JSON.stringify(ladder[1]) + '）');
assert(ladder[2].wait === 20 && ladder[2].level === 3, '第 3 次失败 → 等 20 句（got ' + JSON.stringify(ladder[2]) + '）');
assert(ladder[3].wait === 20 && ladder[3].level === 3, '第 4 次失败 → 仍等 20 句，等级封顶（got ' + JSON.stringify(ladder[3]) + '）');

/* ---------- 6. 两个免费引擎都冷却时不得越级冷场 ---------- */
console.log('\n-- 双引擎冷却时仍能翻译 --');
const bg5 = makeBg(() => true);
const res5 = await bg5.translate({ freeCooldown: { google: 10, bing: 10 }, freeFailLevel: { google: 1, bing: 1 } });
assert(res5.engine !== 'google' && res5.engine !== 'bing', '两个免费引擎都在冷却时改用其他引擎（got ' + res5.engine + '）');
assert(!!res5.translatedText, '依然能拿到译文，不会因为冷却而完全失败');

console.log('\n==== ' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED') + ' ====');
process.exit(failed === 0 ? 0 : 1);
