/* 核心算法回归测试（Node 下模拟 DOM 运行 inject.js）
 * 运行：node tests/kt-core-test.mjs src/inject.js
 * 覆盖：分词 / 设置归一化 / 字幕解析（手动+自动+广播碎片）/ 分块（硬停顿、说话人、标点）/ 句子翻译单元（句末切分、短句合并、逗号截断、定位）/ 气泡挂载与孤儿清理
 */
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(process.argv[2], 'utf8');
const ctx = vm.createContext({
  console,
  setTimeout: () => 1,
  clearTimeout: () => {},
  setInterval: () => 1,
  clearInterval: () => {},
  performance: { now: () => 0 },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  Event: class {},
  URL, URLSearchParams, Intl, Blob: class {}, AbortController,
  fetch: () => Promise.reject(new Error('no-net')),
  crypto: { randomUUID: () => 'uuid' },
  XMLHttpRequest: class {},
  location: { pathname: '/watch', href: 'https://www.youtube.com/watch?v=abc' },
});
ctx.window = ctx;
ctx.addEventListener = () => {};
ctx.removeEventListener = () => {};
ctx.dispatchEvent = () => {};
ctx.document = {
  documentElement: { dataset: {}, addEventListener() {}, dispatchEvent() {}, removeAttribute() {}, setAttribute() {} },
  addEventListener() {},
  createElement(tag) {
    return {
      tagName: tag, id: '',
      style: { setProperty() {}, cssText: '' },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute() {}, removeAttribute() {},
      addEventListener() {}, removeEventListener() {},
      appendChild() {}, remove() {},
      dataset: {}, dir: '', textContent: '',
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 }),
      querySelectorAll: () => [],
      querySelector: () => null,
      getContext: () => ({ measureText: (t) => ({ width: String(t).length * 10 }) }),
    };
  },
  createRange() { return { selectNodeContents() {}, getClientRects() { return []; } }; },
  head: { contains: () => false, appendChild() {}, removeChild() {} },
  body: { contains: () => true, appendChild() {} },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  fullscreenElement: null,
  fonts: undefined,
};
ctx.navigator = { clipboard: undefined };
ctx.getComputedStyle = () => ({
  fontWeight: '400',
  fontSize: '24px',
  fontFamily: 'sans-serif',
  letterSpacing: '0.01em',
  color: '#fff',
  backgroundColor: 'rgba(0,0,0,0.45)',
  backgroundImage: 'none',
  textShadow: 'none',
});
vm.runInContext(code, ctx);

const api = ctx.__ktApi;
let failed = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); failed++; } else console.log('PASS:', msg);
};
const mkWords = (arr, gap = 350) => {
  const out = [];
  let t = 0;
  for (const w of arr) {
    out.push({ start: t, end: t + 300, text: w, eventIndex: 0, preserveBoundary: false });
    t += 300 + gap;
  }
  return out;
};

/* 1. 分词 */
const words1 = api.splitIntoWords('Hello, world! I like it.');
assert(words1.length === 5, '英文 5 词，got ' + words1.length);
assert(words1.map((w) => w.text).join(' ') === 'Hello, world! I like it.', '英文分词拼接无损');
const words2 = api.splitIntoWords('我喜欢看视频');
assert(words2.length === 4, '中文分词 4 词，got ' + words2.length);

/* 2. 设置归一化 */
const s = api.normalizeSettings({ targetLines: 3, textSize: 'xxlarge' });
assert(s.targetLines === 3 && s.textSize === 'xxlarge', '设置归一化');
assert(s.tooltip.fontFamily === 'auto', '嵌套默认值');

/* 3. 手动字幕解析 */
const mw = api.extractWords({ events: [
  { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello world' }] },
  { tStartMs: 3000, dDurationMs: 2000, segs: [{ utf8: 'This is a test' }] },
]});
assert(mw.length === 6 && mw[0].start === 1000, '手动字幕 6 词');

/* 4. 广播碎片拼接 */
const aw = api.extractWords({ events: [
  { tStartMs: 0, dDurationMs: 500, wWinId: 1, segs: [{ utf8: 'GO', tOffsetMs: 0 }, { utf8: 'ING', tOffsetMs: 200 }] },
  { tStartMs: 600, dDurationMs: 400, wWinId: 1, segs: [{ utf8: ' TO', tOffsetMs: 0 }] },
]});
assert(aw.length === 2, '自动字幕 2 词');
assert(aw[0].text === 'GOING', '碎片拼成 GOING，got ' + aw[0].text);
assert(aw[1].text === 'TO', 'TO 无前导空格，got [' + aw[1].text + ']');

/* 5. 硬停顿断块 */
api.STATE.settings.targetLines = 2;
api.STATE.layout = { textWidthPx: 400, fontSizePx: 24, targetLines: 2 };
api.STATE.measurerText = { textContent: '' };
const hw = mkWords(['one', 'two', 'three', 'four', 'five']);
hw[3].start = hw[2].start + 300 + 6000;
hw[3].end = hw[3].start + 300;
hw[4].start = hw[3].start + 300;
hw[4].end = hw[4].start + 300;
const hchunks = await api.chunkWords(hw);
assert(hchunks.length === 2, '硬停顿切成 2 块，got ' + hchunks.length);
assert(hchunks[0].reason.includes('hard_pause'), '原因含 hard_pause，got ' + hchunks[0].reason);
assert(hchunks[0].longPauseHideAtMs != null, '长停顿生成隐藏时间点');

/* 6. 说话人切换断块 */
const schunks = await api.chunkWords(mkWords(['hello', 'there', '>>Bob', 'hi']));
assert(schunks.length >= 2 && schunks[0].reason === 'speaker_change', '说话人切换断块，got ' + schunks.map((c) => c.reason).join(','));

/* 7. 标点断句（两行 + 末行填充 ≥45% 时） */
const pchunks = await api.chunkWords(mkWords(['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee', 'ffffffff', 'gggggggg', 'mmmmmmmm.', 'nnnnnnnn', 'oooooooo']));
assert(pchunks.length === 2, '标点断句成 2 块，got ' + pchunks.length);
assert(pchunks[0].reason.startsWith('punctuation'), '原因 punctuation，got ' + pchunks[0].reason);
assert(pchunks[1].reason === 'end_of_captions', '尾部收尾，got ' + pchunks[1].reason);

/* 8. 句子单元：句末标点切分 */
const su1 = api.buildSentenceUnits(mkWords(['one', 'two', 'three', 'four.', 'five', 'six', 'seven', 'eight.']));
assert(su1.length === 2, '句末标点切成 2 句，got ' + su1.length);
assert(su1[0].endIndex === 4 && su1[1].startIndex === 4, '句边界下标正确');

/* 9. 句子单元：硬停顿切分 */
const spWords = mkWords(['one', 'two', 'three', 'four', 'five', 'six']);
spWords[3].start = spWords[2].end + 6000;
spWords[3].end = spWords[3].start + 300;
spWords[4].start = spWords[3].end + 350;
spWords[4].end = spWords[4].start + 300;
spWords[5].start = spWords[4].end + 350;
spWords[5].end = spWords[5].start + 300;
const su2 = api.buildSentenceUnits(spWords);
assert(su2.length === 2, '硬停顿切成 2 句，got ' + su2.length);

/* 10. 短句合并：3 词短句 + 下一句 4 词 → 1 个翻译单元 */
const tuWords = mkWords(['I', 'see', 'you.', 'This', 'is', 'four', 'words.']);
const su3 = api.buildSentenceUnits(tuWords);
assert(su3.length === 2, '短句合并前有 2 句，got ' + su3.length);
const tu1 = api.assembleTranslationUnits(tuWords);
assert(tu1.length === 1, '短句合并为 1 个翻译单元，got ' + tu1.length);
assert(tu1[0].endIndex === 7, '合并单元覆盖 7 词，got ' + tu1[0].endIndex);
assert(tu1[0].text === 'I see you. This is four words.', '合并文本正确，got [' + tu1[0].text + ']');

/* 11. 长句按逗号截断：9 词（约 5.5s 超上限）在逗号处截成 2 个单元 */
const longWords = mkWords(['w0', 'w1', 'w2', 'w3,', 'w4', 'w5', 'w6', 'w7', 'w8']);
const tu2 = api.assembleTranslationUnits(longWords);
assert(tu2.length === 2, '超时按逗号截成 2 个单元，got ' + tu2.length);
assert(tu2[0].endIndex === 4 && tu2[0].text.endsWith(','), '第一单元截至逗号，got [' + tu2[0].text + ']');
assert(tu2[1].startIndex === 4, '第二单元从逗号后开始，got ' + tu2[1].startIndex);

/* 12. 翻译单元二分定位 */
const tuWords2 = mkWords(['one', 'two', 'three', 'four.', 'five', 'six', 'seven', 'eight.']);
api.STATE.translationUnits = api.assembleTranslationUnits(tuWords2);
assert(api.STATE.translationUnits.length === 2, '定位前有 2 个翻译单元');
assert(api.findTranslationUnit(2) === api.STATE.translationUnits[0], '二分定位到单元 0');
assert(api.findTranslationUnit(5) === api.STATE.translationUnits[1], '二分定位到单元 1');
assert(api.findTranslationUnit(-1) === null, '负下标返回 null');
assert(api.findTranslationUnit(99) === null, '越界大下标返回 null');

/* 13. 文字透明度归一化（0–100，步进 5） */
assert(api.normalizeSettings({ textOpacity: 37 }).textOpacity === 35, '透明度 37 → 35，got ' + api.normalizeSettings({ textOpacity: 37 }).textOpacity);
assert(api.normalizeSettings({ textOpacity: 150 }).textOpacity === 100, '透明度 150 → 100');
assert(api.normalizeSettings({ textOpacity: -10 }).textOpacity === 0, '透明度 -10 → 0');
assert(api.normalizeSettings({ textOpacity: 'abc' }).textOpacity === 100, '非法透明度回退 100');
assert(api.normalizeSettings({ textOpacity: 75 }).textOpacity === 75, '旧值 75 仍合法');

/* 14. 孤儿节点清理 + 挂载宿主跟随全屏（"多个气泡叠在一起"的根治逻辑） */
const mkParent = (id, tag) => ({
  id, tagName: tag, children: [],
  appendChild(n) { n.parentNode = this; n.parentElement = this; this.children.push(n); return n; },
  removeChild(n) { this.children = this.children.filter((c) => c !== n); n.parentNode = null; n.parentElement = null; return n; },
});
const mkNode = (id) => ({
  id, isConnected: true, parentNode: null, parentElement: null,
  style: {}, classList: { contains: () => false },
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 }),
});
const fakeBody = mkParent('body', 'body');
const fakeFs = mkParent('movie_player', 'div');
ctx.document.body = fakeBody;
ctx.document.fullscreenElement = fakeFs;
ctx.document.getElementById = (id) => [...fakeFs.children, ...fakeBody.children].find((n) => n.id === id) || null;
ctx.document.querySelectorAll = (sel) => {
  const ids = String(sel).split(',').map((s) => s.trim().replace('#', ''));
  return [...fakeFs.children, ...fakeBody.children].filter((n) => ids.indexOf(n.id) >= 0);
};

assert(api.tooltipHost() === fakeFs, '全屏时挂载宿主 = 全屏元素');
ctx.document.fullscreenElement = null;
assert(api.tooltipHost() === fakeBody, '非全屏时挂载宿主 = body');

const keepNode = mkNode('kt-tooltip');
const orphanNode = mkNode('kt-tooltip');
api.STATE.tooltip = keepNode;
fakeBody.appendChild(keepNode);
fakeBody.appendChild(orphanNode);
const purged = api.purgeOrphanNodes();
assert(purged === 1, '清理掉 1 个孤儿气泡，got ' + purged);
assert(fakeBody.children.length === 1 && fakeBody.children[0] === keepNode, '保留 STATE 正在用的气泡');
assert(api.purgeOrphanNodes() === 0, '无孤儿时不再清理（幂等）');

const moveNode = mkNode('kt-notification');
ctx.document.fullscreenElement = fakeFs;
api.mountOverlayNode(moveNode);
assert(moveNode.parentElement === fakeFs, '全屏时节点挂到全屏元素');
ctx.document.fullscreenElement = null;
api.mountOverlayNode(moveNode);
assert(moveNode.parentElement === fakeBody, '退出全屏后节点搬回 body（不重建）');
api.mountOverlayNode(moveNode);
assert(fakeBody.children.filter((c) => c === moveNode).length === 1, '重复挂载不会产生副本节点');

/* ================= 15. 音标：页面侧纯函数 ================= */
console.log('\n-- 音标（页面侧纯函数）--');
assert(api.isEnglishToken('sentiment') === true, 'isEnglishToken: 普通英文词');
assert(api.isEnglishToken("ain't") === true, 'isEnglishToken: 缩写词');
assert(api.isEnglishToken('well-known') === true, 'isEnglishToken: 连字符词');
assert(api.isEnglishToken('情绪') === false, 'isEnglishToken: 中文不算英文');
assert(api.isEnglishToken('Hello!') === false, 'isEnglishToken: 带标点不算（由查表前归一化处理）');
assert(api.ipaLookupKey('  Sentiment. ') === 'sentiment', 'ipaLookupKey: 去空格/大写/尾标点');
assert(api.ipaLookupKey('“Hello”') === 'hello', 'ipaLookupKey: 去中文引号');
assert(api.formatPhonetic(['ˈsentəmənt']) === '/ˈsentəmənt/', 'formatPhonetic: 单个读音加斜杠');
assert(api.formatPhonetic(['lɪv', 'laɪv', 'x']) === '/lɪv/ /laɪv/', 'formatPhonetic: 最多显示 2 个读音');
assert(api.formatPhonetic([]) === '' && api.formatPhonetic(null) === '', 'formatPhonetic: 空输入返回空串');

/* ================= 16. 音标：后台离线词典查表（含回退与注释行） ================= */
console.log('\n-- 音标（后台查表）--');
const bgCode = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const FAKE_TSV = '# 注释行应被跳过\nthe\tðə;ði\nread\triːd;red\nknown\tnoʊn\nsentiment\tˈsentəmənt\n';
let bgListener = null;
const bgCtx = vm.createContext({
  console,
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
  fetch: async () => ({ text: async () => FAKE_TSV }),
  chrome: {
    runtime: {
      getURL: (p) => 'chrome-extension://fake/' + p,
      onMessage: { addListener: (fn) => { bgListener = fn; } },
      onInstalled: { addListener: () => {} },
      lastError: null,
    },
    tabs: { query: async () => [] },
    scripting: { executeScript: async () => {} },
    storage: { local: { get: () => {}, set: () => {} }, onChanged: { addListener: () => {} } },
  },
});
vm.runInContext(bgCode, bgCtx);
assert(typeof bgListener === 'function', '后台注册了 onMessage 监听');

const ipaResp = await new Promise((resolve) => {
  const ret = bgListener({ action: 'kt-ipa-lookup', words: ['The', 'read', 'well-known', 'zzz'] }, {}, resolve);
  assert(ret === true, 'kt-ipa-lookup 返回 true（异步响应）');
});
assert(ipaResp.ok === true, 'kt-ipa-lookup 返回 ok');
assert(JSON.stringify(ipaResp.ipa['The']) === JSON.stringify(['ðə', 'ði']), '查表：The → /ðə/ /ði/（大小写归一）');
assert(JSON.stringify(ipaResp.ipa['read']) === JSON.stringify(['riːd', 'red']), '查表：read → 两个读音');
assert(JSON.stringify(ipaResp.ipa['well-known']) === JSON.stringify(['noʊn']), '查表：well-known 回退到连字符末段');
assert(ipaResp.ipa['zzz'] === undefined, '查表：未命中不返回条目');
assert(ipaResp.size === 4, '查表：TSV 注释行被跳过（4 个词条），got ' + ipaResp.size);

/* ================= 17. 音标：内置数据文件自检 ================= */
console.log('\n-- 音标（内置数据文件）--');
const tsvLines = fs.readFileSync(new URL('../src/data/ipa-en.tsv', import.meta.url), 'utf8')
  .split('\n').filter((l) => l && l[0] !== '#');
assert(tsvLines.length > 100000, '音标词典词条数 > 100000，got ' + tsvLines.length);
const findIpa = (w) => {
  const hit = tsvLines.find((l) => l.startsWith(w + '\t'));
  return hit ? hit.split('\t')[1] : '';
};
assert(findIpa('additional').startsWith('əˈdɪʃənəl'), 'additional → /əˈdɪʃənəl/，got ' + findIpa('additional'));
assert(findIpa('beautiful').startsWith('ˈbjuːtəfəl'), 'beautiful → /ˈbjuːtəfəl/，got ' + findIpa('beautiful'));
assert(findIpa('well-known').startsWith('ˌwelˈnoʊn'), 'well-known → /ˌwelˈnoʊn/，got ' + findIpa('well-known'));
assert(findIpa('live').split(';')[0] === 'ˈlɪv', 'live 首选 /ˈlɪv/（常用读音优先表），got ' + findIpa('live'));
assert(findIpa('read').split(';')[0] === 'ˈriːd', 'read 首选 /ˈriːd/（常用读音优先表），got ' + findIpa('read'));
assert(findIpa('was').split(';')[0] === 'wəz', 'was 首选 /wəz/（常用读音优先表），got ' + findIpa('was'));
assert(findIpa('record').split(';')[0] === 'ˈrekərd', 'record 首选 /ˈrekərd/（常用读音优先表），got ' + findIpa('record'));
assert(!/\n/.test(findIpa('sentiment')), 'sentiment 音标不含换行（数据格式干净）');

console.log('\n==== ' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED') + ' ====');
process.exit(failed === 0 ? 0 : 1);
