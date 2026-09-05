/* 核心算法回归测试（Node 下模拟 DOM 运行 inject.js）
 * 运行：node tests/kt-core-test.mjs src/inject.js
 * 覆盖：分词 / 设置归一化 / 字幕解析（手动+自动+广播碎片）/ 分块（硬停顿、说话人、标点）
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

console.log('\n==== ' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED') + ' ====');
process.exit(failed === 0 ? 0 : 1);
