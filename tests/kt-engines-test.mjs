
/* 翻译引擎回归测试（0.4.3）
 * 运行：node tests/kt-engines-test.mjs
 * 覆盖：DeepL 语言映射 / MyMemory 额度熔断 / 自定义端点响应解析宽容度
 */
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url);
const bgCode = fs.readFileSync(new URL('src/background.js', ROOT), 'utf8');

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); failed++; } else console.log('PASS:', msg);
};

/* ---------- 构造可注入 fetch / chrome 的后台上下文 ---------- */
function makeBg(fetchImpl) {
  let listener = null;
  const ctx = vm.createContext({
    console,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    Blob, Response, DecompressionStream,
    fetch: fetchImpl,
    crypto: globalThis.crypto,
    indexedDB: undefined,
    importScripts: () => {},
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
        local: { get: (defaults, cb) => cb && cb({ ktSettings: null }), set: () => {} },
        onChanged: { addListener: () => {} },
      },
    },
  });
  ctx.globalThis = ctx;
  vm.runInContext(bgCode, ctx);
  return { ctx, getListener: () => listener };
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const jsonResp = (obj, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => obj, text: async () => JSON.stringify(obj), headers: JSON_HEADERS,
});

/* ---------- 1. DeepL 语言代码映射 ---------- */
console.log('\n-- DeepL 语言映射 --');
const bg = makeBg(async () => jsonResp({}));
const DeepL = vm.runInContext('DeepLTranslator', bg.ctx);

const targetCases = [
  ['zh-CN', 'ZH-HANS'], ['zh-TW', 'ZH-HANT'], ['zh', 'ZH'], ['en', 'EN-US'],
  ['en-GB', 'EN-GB'], ['pt-BR', 'PT-BR'], ['ja', 'JA'], ['ko', 'KO'], ['auto', 'AUTO'],
];
for (const [input, expected] of targetCases) {
  const got = DeepL.targetFor(input);
  assert(got === expected, 'targetFor(' + JSON.stringify(input) + ') = ' + got + '（期望 ' + expected + '）');
}
assert(DeepL.targetFor('') === 'ZH', 'targetFor("") 回退 ZH');

const sourceCases = [['auto', ''], ['', ''], ['zh-CN', 'ZH'], ['en', 'EN'], ['ja', 'JA']];
for (const [input, expected] of sourceCases) {
  const got = DeepL.sourceFor(input);
  assert(got === expected, 'sourceFor(' + JSON.stringify(input) + ') = ' + JSON.stringify(got) + '（期望 ' + JSON.stringify(expected) + '）');
}

/* ---------- 2. DeepL 端点选择与错误码 ---------- */
console.log('\n-- DeepL 端点与错误处理 --');
const inst = new DeepL();
assert(inst.endpointFor('abc:fx') === 'https://api-free.deepl.com/v2/translate', 'Free key（:fx 结尾）走 api-free');
assert(inst.endpointFor('abc') === 'https://api.deepl.com/v2/translate', 'Pro key 走 api.deepl.com');

const okBg = makeBg(async () => jsonResp({
  translations: [{ text: '你好', detected_source_language: 'EN' }],
}));
const okDeepL = new (vm.runInContext('DeepLTranslator', okBg.ctx))();
const okRes = await okDeepL.translate('hello', 'en', 'zh-CN', null, 'k:fx');
assert(okRes.translatedText === '你好', 'DeepL 正常返回译文');
assert(okRes.detectedLanguageCode === 'EN', 'DeepL 回传检测到的源语言');

const authBg = makeBg(async () => jsonResp({ message: 'nope' }, 403));
const authDeepL = new (vm.runInContext('DeepLTranslator', authBg.ctx))();
let authErr = null;
try { await authDeepL.translate('hello', 'en', 'zh-CN', null, 'bad:fx'); } catch (e) { authErr = e; }
assert(!!authErr && /deepl-auth-failed/.test(authErr.message), '403 → deepl-auth-failed（Key 无效）');

const quotaBg = makeBg(async () => jsonResp({ message: 'quota' }, 456));
const quotaDeepL = new (vm.runInContext('DeepLTranslator', quotaBg.ctx))();
let quotaErr = null;
try { await quotaDeepL.translate('hello', 'en', 'zh-CN', null, 'k:fx'); } catch (e) { quotaErr = e; }
assert(!!quotaErr && /deepl-quota-exceeded/.test(quotaErr.message), '456 → deepl-quota-exceeded（额度用尽）');

const noKeyDeepL = new (vm.runInContext('DeepLTranslator', makeBg(async () => jsonResp({})).ctx))();
let noKeyErr = null;
try { await noKeyDeepL.translate('hello', 'en', 'zh-CN', null, ''); } catch (e) { noKeyErr = e; }
assert(!!noKeyErr && /deepl-no-key/.test(noKeyErr.message), '无 key 时直接失败，不发请求');

/* ---------- 3. MyMemory 额度熔断 ---------- */
console.log('\n-- MyMemory 额度熔断 --');
const mmBg = makeBg(async () => jsonResp({
  responseData: { translatedText: '你好' }, responseStatus: 200, quotaFinished: false,
}));
const MyMemory = vm.runInContext('MyMemoryTranslator', mmBg.ctx);
const mm = new MyMemory();
const mmRes = await mm.translate('hello', 'en', 'zh-CN', null);
assert(mmRes.translatedText === '你好', 'MyMemory 正常返回译文');
assert(mm.isQuotaExhausted() === false, '正常情况未进入熔断');

/* 额度用尽：quotaFinished: true */
const usedBg = makeBg(async () => jsonResp({
  responseData: { translatedText: '' }, responseStatus: 200, quotaFinished: true,
  responseDetails: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY',
}));
const usedMM = new (vm.runInContext('MyMemoryTranslator', usedBg.ctx))();
let usedErr = null;
try { await usedMM.translate('hello', 'en', 'zh-CN', null); } catch (e) { usedErr = e; }
assert(!!usedErr && usedErr.quota === true, 'quotaFinished:true → 标记 quota 错误');
assert(usedMM.isQuotaExhausted() === true, '命中额度后进入熔断状态');

/* 熔断期内不发请求 */
let callsDuringCooldown = 0;
const cooldownBg = makeBg(async () => { callsDuringCooldown++; return jsonResp({}); });
const cdMM = new (vm.runInContext('MyMemoryTranslator', cooldownBg.ctx))();
cdMM.quotaCooldownUntil = Date.now() + 60 * 60 * 1000;
let cdErr = null;
try { await cdMM.translate('hello', 'en', 'zh-CN', null); } catch (e) { cdErr = e; }
assert(!!cdErr && cdErr.quota === true, '熔断期内直接抛 quota 错误');
assert(callsDuringCooldown === 0, '熔断期内完全不发网络请求');

/* 429 也要熔断 */
const r429Bg = makeBg(async () => jsonResp({}, 429));
const r429MM = new (vm.runInContext('MyMemoryTranslator', r429Bg.ctx))();
let r429Err = null;
try { await r429MM.translate('hello', 'en', 'zh-CN', null); } catch (e) { r429Err = e; }
assert(!!r429Err && r429Err.quota === true, 'HTTP 429 → 标记 quota 错误');
assert(r429MM.isQuotaExhausted() === true, 'HTTP 429 后进入熔断');

/* 译文本身是 MYMEMORY WARNING 提示语，不能当译文显示给用户 */
const warnBg = makeBg(async () => jsonResp({
  responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' },
  responseStatus: 200, quotaFinished: false,
}));
const warnMM = new (vm.runInContext('MyMemoryTranslator', warnBg.ctx))();
let warnErr = null;
try { await warnMM.translate('hello', 'en', 'zh-CN', null); } catch (e) { warnErr = e; }
assert(!!warnErr && warnErr.quota === true, '译文是 MYMEMORY WARNING 时当失败处理（不显示英文提示）');

/* ---------- 4. 自定义端点响应解析宽容度 ---------- */
console.log('\n-- 自定义端点解析 --');
const customShapes = [
  [{ translatedText: '你好' }, 'translatedText'],
  [{ translation: '你好' }, 'translation'],
  [{ text: '你好' }, 'text'],
  [{ data: { translatedText: '你好' } }, 'data.translatedText'],
];
for (const [payload, label] of customShapes) {
  const cBg = makeBg(async () => jsonResp(payload));
  const C = vm.runInContext('CustomEndpointTranslator', cBg.ctx);
  const c = new C();
  const res = await c.translate('hello', 'en', 'zh-CN', null, 'https://example.com/t');
  assert(res.translatedText === '你好', '自定义端点接受返回字段 ' + label);
}

const emptyBg = makeBg(async () => jsonResp({}));
const emptyCustom = new (vm.runInContext('CustomEndpointTranslator', emptyBg.ctx))();
let emptyErr = null;
try { await emptyCustom.translate('hello', 'en', 'zh-CN', null, 'https://example.com/t'); } catch (e) { emptyErr = e; }
assert(!!emptyErr && /custom-empty/.test(emptyErr.message), '端点返回无可识别字段 → custom-empty');

const noEpBg = makeBg(async () => jsonResp({}));
const noEpCustom = new (vm.runInContext('CustomEndpointTranslator', noEpBg.ctx))();
let noEpErr = null;
try { await noEpCustom.translate('hello', 'en', 'zh-CN', null, ''); } catch (e) { noEpErr = e; }
assert(!!noEpErr && /custom-no-endpoint/.test(noEpErr.message), '未填端点 → custom-no-endpoint');

console.log('\n==== ' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED') + ' ====');
process.exit(failed === 0 ? 0 : 1);
