
/* 设置持久化回归测试
 * 运行：node tests/kt-settings-persist-test.mjs
 *
 * 复现并回归 Bug：popup 的 normalizeSettings 里 pick() 未判空 allowed，
 * coerce 返回 null 时抛 TypeError → 被 init() 的 catch 吞掉并整体重置为默认值
 * → 用户改过的外观 / 行为设置每次重开弹窗全部丢失。
 */
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url);
const code = fs.readFileSync(new URL('src/popup.js', ROOT), 'utf8');

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); failed++; } else console.log('PASS:', msg);
};

/* ---------- 假 DOM + 假 chrome.storage（真实 JSON 往返） ---------- */
const store = {};
const chromeStub = {
  runtime: {
    getManifest: () => ({ version: '0.0.0' }),
    getURL: (p) => p,
    connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {}, disconnect() {} }),
    sendMessage: (m, cb) => { if (cb) cb({ ok: true, dicts: {}, installed: {} }); },
  },
  storage: {
    local: {
      set: async (items) => {
        for (const k of Object.keys(items)) store[k] = JSON.parse(JSON.stringify(items[k]));
      },
      get: async (defaults) => {
        const out = {};
        for (const k of Object.keys(defaults || {})) {
          out[k] = store[k] !== undefined ? JSON.parse(JSON.stringify(store[k])) : defaults[k];
        }
        return out;
      },
    },
  },
  tabs: { query: async () => [], create: async () => {} },
};

const makeEl = (id) => ({
  id, value: '', checked: false, textContent: '', innerHTML: '',
  style: {}, dataset: {}, title: '', children: [], tagName: 'DIV',
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, querySelectorAll: () => [], contains: () => false, closest: () => null,
  appendChild(c) { this.children.push(c); }, remove() {},
});

const makeContext = () => {
  const els = new Map();
  const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const ctx = vm.createContext({
    console,
    document: {
      getElementById: getEl, querySelectorAll: () => [], addEventListener() {},
      createElement: () => makeEl('x'), body: { appendChild() {}, contains: () => true }, title: '',
    },
    chrome: chromeStub,
    fetch: async () => { throw new Error('no-net'); },
    URL, Blob, setTimeout, clearTimeout, Promise,
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.runInContext(code, ctx);
  return ctx;
};

/* ---------- 1. normalizeSettings 不再因 null allowed 抛错 ---------- */
const ctx = makeContext();
const api = ctx.__ktPopupApi;
assert(!!api && typeof api.normalizeSettings === 'function', 'popup.js 暴露 normalizeSettings（供测试）');

/* 这几个键历史上 allowed 传 null：取值非法时必须回退默认而不抛 TypeError */
const unsafeInputs = [
  { name: 'textOpacity 非法', raw: { textOpacity: 'abc' } },
  { name: 'posX 非法', raw: { posX: 'x' } },
  { name: 'posY 非法', raw: { posY: null } },
  { name: 'widthPercent 非法', raw: { widthPercent: 'abc' } },
  { name: 'dictMirror 非法', raw: { dictMirror: 123 } },
  { name: '全部为 null', raw: { textOpacity: null, posX: null, posY: null, widthPercent: null, dictMirror: null } },
];
for (const c of unsafeInputs) {
  let threw = null;
  let out = null;
  try { out = api.normalizeSettings(c.raw); } catch (e) { threw = e; }
  assert(!threw, 'normalizeSettings(' + c.name + ') 不抛错' + (threw ? '，got ' + threw.message : ''));
  assert(!!out, 'normalizeSettings(' + c.name + ') 返回对象');
}

/* ---------- 2. 所有键的非默认值都能往返（不丢键） ---------- */
const DEFAULTS = api.DEFAULT_SETTINGS;
const custom = api.deepClone(DEFAULTS);
Object.assign(custom, {
  enabled: false, manualCaptions: 'keep', targetLines: 1, textSize: 'xlarge',
  font: 'roboto', positionMode: 'custom', position: 'right-top', posX: 12, posY: 93,
  textColor: 'yellow', textOpacity: 45, captionWidth: 'custom', widthPercent: 33,
  allCaps: true, textOutline: true, textBold: true, background: 75,
  translator: 'bing', sourceLanguage: 'auto', targetLanguage: 'ja',
  autoPause: false, leftClickAction: 'copy-original', alwaysMultipleSelection: true,
  showNotifications: false, sentenceTranslation: false, translationEnabled: false,
  showPhonetic: false, offlineDict: false, dictSource: 'online',
  dictMirror: 'https://example.com/d', uiLang: 'en', debug: true,
});
custom.tooltip = {
  fontFamily: 'monospaced-serif', fontSize: '150%', fontColor: 'yellow', fontOpacity: '75%',
  backgroundColor: 'black', backgroundOpacity: '50%', characterEdgeStyle: 'outline', textBold: true,
};

const round1 = api.normalizeSettings(custom);
let lost = 0;
for (const k of Object.keys(custom)) {
  if (JSON.stringify(round1[k]) !== JSON.stringify(custom[k])) {
    console.log('  LOST', k, 'expected', JSON.stringify(custom[k]), 'got', JSON.stringify(round1[k]));
    lost++;
  }
}
assert(lost === 0, '全部 ' + Object.keys(custom).length + ' 个设置键往返后不丢失（含 tooltip 子对象）');

/* 幂等：再归一化一次结果不变 */
const round2 = api.normalizeSettings(round1);
let unstable = 0;
for (const k of Object.keys(round1)) {
  if (JSON.stringify(round1[k]) !== JSON.stringify(round2[k])) { console.log('  UNSTABLE', k); unstable++; }
}
assert(unstable === 0, 'normalizeSettings 幂等（重复归一化结果稳定）');

/* ---------- 3. 真实「保存 → 重开」链路 ---------- */
const ctx1 = makeContext();
await new Promise((r) => setTimeout(r, 40));
const settings1 = vm.runInContext('settings', ctx1);
Object.assign(settings1, {
  textSize: 'xlarge', textOpacity: 45, posX: 12, posY: 93,
  captionWidth: 'custom', widthPercent: 33, background: 75,
  allCaps: true, font: 'roboto', textColor: 'yellow',
});
settings1.tooltip.fontSize = '150%';
const save = vm.runInContext('save', ctx1);
await save();

assert(store.ktSettings.textSize === 'xlarge', '保存后 storage.textSize = xlarge');
assert(store.ktSettings.textOpacity === 45, '保存后 storage.textOpacity = 45');
assert(store.ktSettings.tooltip.fontSize === '150%', '保存后 storage.tooltip.fontSize = 150%');

/* 重新打开弹窗 */
const ctx2 = makeContext();
await new Promise((r) => setTimeout(r, 40));
const settings2 = vm.runInContext('settings', ctx2);
const expect = {
  textSize: 'xlarge', textOpacity: 45, posX: 12, posY: 93,
  captionWidth: 'custom', widthPercent: 33, background: 75,
  allCaps: true, font: 'roboto', textColor: 'yellow',
};
let lost2 = 0;
for (const k of Object.keys(expect)) {
  if (JSON.stringify(settings2[k]) !== JSON.stringify(expect[k])) {
    console.log('  LOST', k, 'expected', JSON.stringify(expect[k]), 'got', JSON.stringify(settings2[k]));
    lost2++;
  }
}
if (settings2.tooltip.fontSize !== '150%') { console.log('  LOST tooltip.fontSize'); lost2++; }
assert(lost2 === 0, '重开弹窗后外观设置全部保留（' + Object.keys(expect).length + ' 键 + tooltip）');
assert(store.ktSettings.textSize === 'xlarge', '重开过程不会把 storage 里的值改回默认');

/* ---------- 4. 读取失败时不得整体重置 ---------- */
const ctx3 = makeContext();
await new Promise((r) => setTimeout(r, 40));
const settings3 = vm.runInContext('settings', ctx3);
settings3.textSize = 'xlarge';
/* 让下一次 storage.get 抛错，模拟读取异常 */
chromeStub.storage.local.get = async () => { throw new Error('boom'); };
const init3 = vm.runInContext('init', ctx3);
await init3();
const after3 = vm.runInContext('settings', ctx3);
assert(after3.textSize === 'xlarge', 'storage 读取抛错时保留当前设置，不重置为默认（got ' + after3.textSize + '）');

console.log('\n==== ' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED') + ' ====');
process.exit(failed === 0 ? 0 : 1);
