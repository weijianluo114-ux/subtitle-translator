'use strict';

/* 弹窗逻辑：hover-translate 风格双标签（设置 / 外观），原生实现。
 * 设置统一存 chrome.storage.local["ktSettings"]，由 storage-bridge 推给所有 YouTube 标签。
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  manualCaptions: 'rechunk',
  targetLines: 2,
  textSize: 'medium',
  font: 'atkinson',
  positionMode: 'preset',
  position: 'center-low',
  posX: 50,
  posY: 70,
  textColor: 'white',
  textOpacity: 100,
  captionWidth: 'auto',
  widthPercent: 50,
  allCaps: false,
  textOutline: false,
  textBold: false,
  background: 50,
  translator: 'google',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  autoPause: true,
  leftClickAction: 'copy-translation',
  alwaysMultipleSelection: false,
  showNotifications: true,
  sentenceTranslation: true,
  translationEnabled: true,
  tooltipFollowSubtitle: true,
  tooltip: {
    fontFamily: 'auto',
    fontSize: 'auto',
    fontColor: 'auto',
    fontOpacity: 'auto',
    backgroundColor: 'auto',
    backgroundOpacity: 'auto',
    characterEdgeStyle: 'auto',
    textBold: false,
  },
  uiLang: 'zh_CN',
  debug: false,
};

const I18N = {
  zh_CN: {
    appTitle: '字幕整行翻译',
    tabSettings: '设置',
    tabAppearance: '外观',
    groupTranslation: '翻译',
    groupBehavior: '行为',
    groupSubtitle: '字幕',
    groupPosition: '位置',
    groupWidth: '字幕宽度',
    groupTooltip: '翻译气泡',
    translator: '翻译引擎',
    sourceLanguage: '源语言',
    targetLanguage: '目标语言',
    autoDetect: '自动检测',
    sentenceTranslation: '整句翻译（悬停时显示整行译文）',
    translationEnabled: '启用翻译功能（悬停/整句/暂停/复制）',
    autoPause: '悬停时自动暂停视频',
    leftClickAction: '左键点击单词',
    copyTranslation: '复制译文',
    copyOriginal: '复制原文',
    doNothing: '无动作',
    alwaysMultiple: '始终多选（不用按 Shift）',
    showNotifications: '操作通知',
    debug: '调试模式（开发用）',
    debugDownload: '下载诊断',
    feedback: '反馈 / 建议',
    resetSettings: '重置设置',
    enabled: '启用整行字幕',
    manualCaptions: '手动字幕（创作者 CC）',
    manualRechunk: '重排为整行',
    manualKeep: '原样保留',
    targetLines: '行数',
    textSize: '字号',
    sizeSmall: '小',
    sizeMedium: '中',
    sizeLarge: '大',
    sizeXlarge: '特大',
    sizeXxlarge: '超大',
    font: '字体',
    textColor: '文字颜色',
    colorWhite: '白',
    colorYellow: '黄',
    colorGreen: '绿',
    colorCyan: '青',
    textOpacity: '文字透明度',
    background: '背景深浅',
    allCaps: '全大写',
    textOutline: '文字描边',
    textBold: '加粗',
    positionMode: '位置模式',
    posPreset: '预设 21 宫格',
    posCustom: '自定义滑块',
    posX: '水平位置（左 → 右）',
    posY: '垂直位置（上 → 下）',
    captionWidth: '宽度模式',
    widthAuto: '自动（随字号）',
    widthCustom: '自定义',
    widthPercent: '自定义宽度（屏宽 %）',
    tooltipFollow: '跟随字幕样式',
    ttBold: '气泡文字加粗',
    ttFontFamily: '气泡字体',
    ttFontSize: '气泡字号',
    ttFontColor: '气泡字色',
    ttFontOpacity: '气泡字透明度',
    ttBgColor: '气泡背景色',
    ttBgOpacity: '气泡背景透明度',
    ttEdge: '气泡字符边缘',
    resetAppearance: '重置外观',
    langTip: '界面语言 / UI language',
    donateSub: '扫码请我喝杯咖啡，支持学费',
  },
  en: {
    appTitle: 'Subtitle Line Translator',
    tabSettings: 'Settings',
    tabAppearance: 'Appearance',
    groupTranslation: 'Translation',
    groupBehavior: 'Behavior',
    groupSubtitle: 'Subtitles',
    groupPosition: 'Position',
    groupWidth: 'Caption width',
    groupTooltip: 'Tooltip',
    translator: 'Translator',
    sourceLanguage: 'From',
    targetLanguage: 'To',
    autoDetect: 'Auto detect',
    sentenceTranslation: 'Whole-line translation on hover',
    translationEnabled: 'Enable translation (hover/line/pause/copy)',
    autoPause: 'Auto-pause video on hover',
    leftClickAction: 'Left click on word',
    copyTranslation: 'Copy translation',
    copyOriginal: 'Copy original',
    doNothing: 'Nothing',
    alwaysMultiple: 'Always multi-select (no Shift)',
    showNotifications: 'Show notifications',
    debug: 'Debug mode (dev)',
    debugDownload: 'Download diagnostic',
    feedback: 'Feedback',
    resetSettings: 'Reset settings',
    enabled: 'Enable line captions',
    manualCaptions: 'Manual captions (creator CC)',
    manualRechunk: 'Rechunk into lines',
    manualKeep: 'Keep as written',
    targetLines: 'Lines',
    textSize: 'Text size',
    sizeSmall: 'Small',
    sizeMedium: 'Medium',
    sizeLarge: 'Large',
    sizeXlarge: 'X-Large',
    sizeXxlarge: 'XX-Large',
    font: 'Font',
    textColor: 'Text color',
    colorWhite: 'White',
    colorYellow: 'Yellow',
    colorGreen: 'Green',
    colorCyan: 'Cyan',
    textOpacity: 'Text opacity',
    background: 'Background shade',
    allCaps: 'All caps',
    textOutline: 'Text outline',
    textBold: 'Bold',
    positionMode: 'Position mode',
    posPreset: '21-grid preset',
    posCustom: 'Custom sliders',
    posX: 'Horizontal (left → right)',
    posY: 'Vertical (top → bottom)',
    captionWidth: 'Width mode',
    widthAuto: 'Auto (follow size)',
    widthCustom: 'Custom',
    widthPercent: 'Custom width (% of player)',
    tooltipFollow: 'Follow subtitle style',
    ttBold: 'Tooltip bold',
    ttFontFamily: 'Tooltip font',
    ttFontSize: 'Tooltip size',
    ttFontColor: 'Tooltip color',
    ttFontOpacity: 'Tooltip font opacity',
    ttBgColor: 'Tooltip background',
    ttBgOpacity: 'Tooltip bg opacity',
    ttEdge: 'Tooltip edge style',
    resetAppearance: 'Reset appearance',
    langTip: 'UI language',
    donateSub: 'Scan to buy me a coffee — supports my school fees',
  },
};

const SETTINGS_KEY = 'ktSettings';
let uiLang = 'zh_CN';
let settings = { ...DEFAULT_SETTINGS };
let languages = { targetLanguages: [], sourceLanguages: [] };

const $ = (id) => document.getElementById(id);
const t = (key) => (I18N[uiLang] && I18N[uiLang][key]) || I18N.zh_CN[key] || key;

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (el.tagName === 'OPTION') el.textContent = t(key);
    else el.textContent = t(key);
  });
  document.title = t('appTitle');
  $('lang-select').title = t('langTip');
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function normalizeSettings(raw) {
  const s = deepClone(DEFAULT_SETTINGS);
  const src = raw && typeof raw === 'object' ? raw : {};
  const pick = (key, allowed, coerce) => {
    const v = src[key];
    if (coerce) {
      const c = coerce(v);
      if (c != null) { s[key] = c; return; }
    }
    if (allowed.includes(v)) s[key] = v;
  };
  pick('enabled', [true, false], (v) => (typeof v === 'boolean' ? v : null));
  pick('manualCaptions', ['rechunk', 'keep']);
  pick('targetLines', [1, 2, 3], (v) => ([1, 2, 3].includes(Number(v)) ? Number(v) : null));
  pick('textSize', ['small', 'medium', 'large', 'xlarge', 'xxlarge']);
  pick('font', ['atkinson', 'cascadia', 'noto', 'average', 'roboto', 'bona']);
  pick('positionMode', ['preset', 'custom']);
  pick('position', ['left-top','center-top','right-top','left-high','center-high','right-high','left-highish','center-highish','right-highish','left-middle','center-middle','right-middle','left-lowish','center-lowish','right-lowish','left-low','center-low','right-low','left-bottom','center-bottom','right-bottom']);
  pick('posX', null, (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null; });
  pick('posY', null, (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null; });
  pick('textColor', ['white', 'yellow', 'green', 'cyan']);
  pick('textOpacity', [100, 75, 50], (v) => ([100, 75, 50].includes(Number(v)) ? Number(v) : null));
  pick('captionWidth', ['auto', 'third', 'half', 'twothirds', 'custom']);
  pick('widthPercent', null, (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(10, Math.min(100, n)) : null; });
  pick('allCaps', [true, false], (v) => (typeof v === 'boolean' ? v : null));
  pick('textOutline', [true, false], (v) => (typeof v === 'boolean' ? v : null));
  pick('textBold', [true, false], (v) => (typeof v === 'boolean' ? v : null));
  pick('background', [0, 25, 50, 75, 100], (v) => ([0, 25, 50, 75, 100].includes(Number(v)) ? Number(v) : null));
  pick('translator', ['google', 'bing']);
  pick('sourceLanguage', ['auto']);
  if (typeof src.targetLanguage === 'string' && src.targetLanguage) s.targetLanguage = src.targetLanguage;
  pick('autoPause', [true, false], (v) => (typeof v === 'boolean' ? v : null));
  pick('leftClickAction', ['copy-translation', 'copy-original', 'nothing']);
  pick('alwaysMultipleSelection', [true, false], (v) => (typeof v === 'boolean' ? v : null));
  pick('showNotifications', [true, false], (v) => (typeof v === 'boolean' ? v : null));
  pick('sentenceTranslation', [true, false], (v) => (typeof v === 'boolean' ? v : null));
  pick('translationEnabled', [true, false], (v) => (typeof v === 'boolean' ? v : null));
  pick('tooltipFollowSubtitle', [true, false], (v) => (typeof v === 'boolean' ? v : null));
  if (src.tooltip && typeof src.tooltip === 'object') {
    const tk = ['fontFamily','fontSize','fontColor','fontOpacity','backgroundColor','backgroundOpacity','characterEdgeStyle','textBold'];
    for (const k of tk) {
      const v = src.tooltip[k];
      if (typeof v === 'string' || typeof v === 'boolean') s.tooltip[k] = v;
    }
  }
  if (src.uiLang === 'en' || src.uiLang === 'zh_CN') s.uiLang = src.uiLang;
  pick('debug', [true, false], (v) => (typeof v === 'boolean' ? v : null));
  return s;
}

async function save() {
  try { await chrome.storage.local.set({ [SETTINGS_KEY]: settings }); }
  catch (e) { /* ignore */ }
}

function render() {
  $('translator').value = settings.translator;
  $('source-language').value = settings.sourceLanguage;
  $('target-language').value = settings.targetLanguage;
  $('sentence-translation').checked = settings.sentenceTranslation;
  $('translation-enabled').checked = settings.translationEnabled;
  $('auto-pause').checked = settings.autoPause;
  $('left-click-action').value = settings.leftClickAction;
  $('always-multiple').checked = settings.alwaysMultipleSelection;
  $('show-notifications').checked = settings.showNotifications;
  $('debug').checked = settings.debug;

  $('enabled').checked = settings.enabled;
  $('manual-captions').value = settings.manualCaptions;
  $('target-lines').value = String(settings.targetLines);
  $('text-size').value = settings.textSize;
  $('font').value = settings.font;
  $('text-color').value = settings.textColor;
  $('text-opacity').value = String(settings.textOpacity);
  $('background').value = String(settings.background);
  $('all-caps').checked = settings.allCaps;
  $('text-outline').checked = settings.textOutline;
  $('text-bold').checked = settings.textBold;

  $('position-mode').value = settings.positionMode;
  document.querySelectorAll('#position-grid button').forEach((b) => {
    b.classList.toggle('active', b.dataset.pos === settings.position);
  });
  $('pos-x').value = String(settings.posX);
  $('pos-y').value = String(settings.posY);
  $('custom-position').classList.toggle('kt-hidden', settings.positionMode !== 'custom');
  $('position-grid').classList.toggle('kt-hidden', settings.positionMode !== 'preset');

  $('caption-width').value = settings.captionWidth;
  $('width-percent').value = String(settings.widthPercent);
  $('width-custom-row').classList.toggle('kt-hidden', settings.captionWidth !== 'custom');

  $('tooltip-follow').checked = settings.tooltipFollowSubtitle;
  $('tooltip-bold').checked = settings.tooltip.textBold;
  $('tooltip-custom').classList.toggle('kt-hidden', settings.tooltipFollowSubtitle);
  $('tooltip-font-family').value = settings.tooltip.fontFamily;
  $('tooltip-font-size').value = settings.tooltip.fontSize;
  $('tooltip-font-color').value = settings.tooltip.fontColor;
  $('tooltip-font-opacity').value = settings.tooltip.fontOpacity;
  $('tooltip-bg-color').value = settings.tooltip.backgroundColor;
  $('tooltip-bg-opacity').value = settings.tooltip.backgroundOpacity;
  $('tooltip-edge').value = settings.tooltip.characterEdgeStyle;

  $('lang-select').value = settings.uiLang;
}

function fillLanguageSelects() {
  const srcSel = $('source-language');
  const dstSel = $('target-language');
  const target = languages.targetLanguages;
  for (const lang of target) {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = lang.name;
    dstSel.appendChild(opt);
    const opt2 = document.createElement('option');
    opt2.value = lang.code;
    opt2.textContent = lang.name;
    srcSel.appendChild(opt2);
  }
  srcSel.value = settings.sourceLanguage;
  dstSel.value = settings.targetLanguage;
}

/* 工具：给 tooltip 下拉框填选项 */
const TOOLTIP_OPTIONS = {
  'tooltip-font-family': [
    ['auto', 'Auto'], ['monospaced-serif', 'Monospaced Serif'], ['proportional-serif', 'Proportional Serif'],
    ['monospaced-sans-serif', 'Monospaced Sans-Serif'], ['proportional-sans-serif', 'Proportional Sans-Serif'],
    ['casual', 'Casual'], ['cursive', 'Cursive'], ['small-capitals', 'Small Capitals'],
  ],
  'tooltip-font-size': [['auto', 'Auto'], ['50%', '50%'], ['75%', '75%'], ['100%', '100%'], ['150%', '150%'], ['200%', '200%'], ['300%', '300%'], ['400%', '400%']],
  'tooltip-font-color': [['auto', 'Auto'], ['white', 'White'], ['yellow', 'Yellow'], ['green', 'Green'], ['cyan', 'Cyan'], ['blue', 'Blue'], ['magenta', 'Magenta'], ['red', 'Red'], ['black', 'Black']],
  'tooltip-font-opacity': [['auto', 'Auto'], ['25%', '25%'], ['50%', '50%'], ['75%', '75%'], ['100%', '100%']],
  'tooltip-bg-color': [['auto', 'Auto'], ['white', 'White'], ['yellow', 'Yellow'], ['green', 'Green'], ['cyan', 'Cyan'], ['blue', 'Blue'], ['magenta', 'Magenta'], ['red', 'Red'], ['black', 'Black']],
  'tooltip-bg-opacity': [['auto', 'Auto'], ['0%', '0%'], ['25%', '25%'], ['50%', '50%'], ['75%', '75%'], ['100%', '100%']],
  'tooltip-edge': [['auto', 'Auto'], ['none', 'None'], ['drop-shadow', 'Drop Shadow'], ['raised', 'Raised'], ['depressed', 'Depressed'], ['outline', 'Outline']],
};

function fillTooltipSelects() {
  for (const [id, opts] of Object.entries(TOOLTIP_OPTIONS)) {
    const sel = $(id);
    sel.textContent = '';
    for (const [value, label] of opts) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    }
  }
}

/* 绑定 */
function bind() {
  const bindSel = (id, apply) => {
    $(id).addEventListener('change', () => { apply(); save(); });
  };
  const bindCheck = (id, apply) => {
    $(id).addEventListener('change', () => { apply(); save(); });
  };

  bindSel('translator', () => { settings.translator = $('translator').value; });
  bindSel('source-language', () => { settings.sourceLanguage = $('source-language').value; });
  bindSel('target-language', () => { settings.targetLanguage = $('target-language').value; });
  bindCheck('sentence-translation', () => { settings.sentenceTranslation = $('sentence-translation').checked; });
  bindCheck('translation-enabled', () => { settings.translationEnabled = $('translation-enabled').checked; });
  bindCheck('auto-pause', () => { settings.autoPause = $('auto-pause').checked; });
  bindSel('left-click-action', () => { settings.leftClickAction = $('left-click-action').value; });
  bindCheck('always-multiple', () => { settings.alwaysMultipleSelection = $('always-multiple').checked; });
  bindCheck('show-notifications', () => { settings.showNotifications = $('show-notifications').checked; });
  bindCheck('debug', () => { settings.debug = $('debug').checked; });

  bindCheck('enabled', () => { settings.enabled = $('enabled').checked; });
  bindSel('manual-captions', () => { settings.manualCaptions = $('manual-captions').value; });
  bindSel('target-lines', () => { settings.targetLines = Number($('target-lines').value); });
  bindSel('text-size', () => { settings.textSize = $('text-size').value; });
  bindSel('font', () => { settings.font = $('font').value; });
  bindSel('text-color', () => { settings.textColor = $('text-color').value; });
  bindSel('text-opacity', () => { settings.textOpacity = Number($('text-opacity').value); });
  bindSel('background', () => { settings.background = Number($('background').value); });
  bindCheck('all-caps', () => { settings.allCaps = $('all-caps').checked; });
  bindCheck('text-outline', () => { settings.textOutline = $('text-outline').checked; });
  bindCheck('text-bold', () => { settings.textBold = $('text-bold').checked; });

  bindSel('position-mode', () => {
    settings.positionMode = $('position-mode').value;
    render();
  });
  document.querySelectorAll('#position-grid button').forEach((b) => {
    b.addEventListener('click', () => {
      settings.position = b.dataset.pos;
      render();
      save();
    });
  });
  $('pos-x').addEventListener('input', () => {
    settings.posX = Number($('pos-x').value);
    save();
  });
  $('pos-y').addEventListener('input', () => {
    settings.posY = Number($('pos-y').value);
    save();
  });

  bindSel('caption-width', () => {
    settings.captionWidth = $('caption-width').value;
    render();
  });
  $('width-percent').addEventListener('input', () => {
    settings.widthPercent = Number($('width-percent').value);
    save();
  });

  bindCheck('tooltip-follow', () => {
    settings.tooltipFollowSubtitle = $('tooltip-follow').checked;
    render();
  });
  bindCheck('tooltip-bold', () => {
    settings.tooltip.textBold = $('tooltip-bold').checked;
  });
  bindSel('tooltip-font-family', () => { settings.tooltip.fontFamily = $('tooltip-font-family').value; });
  bindSel('tooltip-font-size', () => { settings.tooltip.fontSize = $('tooltip-font-size').value; });
  bindSel('tooltip-font-color', () => { settings.tooltip.fontColor = $('tooltip-font-color').value; });
  bindSel('tooltip-font-opacity', () => { settings.tooltip.fontOpacity = $('tooltip-font-opacity').value; });
  bindSel('tooltip-bg-color', () => { settings.tooltip.backgroundColor = $('tooltip-bg-color').value; });
  bindSel('tooltip-bg-opacity', () => { settings.tooltip.backgroundOpacity = $('tooltip-bg-opacity').value; });
  bindSel('tooltip-edge', () => { settings.tooltip.characterEdgeStyle = $('tooltip-edge').value; });

  $('lang-select').addEventListener('change', () => {
    uiLang = $('lang-select').value;
    settings.uiLang = uiLang;
    applyI18n();
    save();
  });

  document.querySelectorAll('.kt-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.kt-tab').forEach((x) => x.classList.toggle('active', x === tab));
      $('panel-settings').classList.toggle('kt-hidden', tab.dataset.tab !== 'settings');
      $('panel-appearance').classList.toggle('kt-hidden', tab.dataset.tab !== 'appearance');
    });
  });

  const SETTINGS_SCOPE = ['translator','sourceLanguage','targetLanguage','sentenceTranslation','translationEnabled','autoPause','leftClickAction','alwaysMultipleSelection','showNotifications','debug'];
  $('reset-settings').addEventListener('click', () => {
    for (const k of SETTINGS_SCOPE) settings[k] = DEFAULT_SETTINGS[k];
    render();
    save();
  });

  /* 右上角打赏小栏目：点击 ☕ 展开/收起，点击面板外关闭 */
  const donateBtn = $('donate-btn');
  const donatePanel = $('donate-panel');
  donateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    donatePanel.classList.toggle('kt-hidden');
  });
  document.addEventListener('click', (e) => {
    if (!donatePanel.classList.contains('kt-hidden') && !donatePanel.contains(e.target) && e.target !== donateBtn) {
      donatePanel.classList.add('kt-hidden');
    }
  });

  $('debug-download').addEventListener('click', async () => {
    const statusEl = $('debug-status');
    const setStatus = (msg, isErr) => {
      statusEl.textContent = msg;
      statusEl.style.color = isErr ? '#d93025' : '#2563eb';
    };
    try {
      setStatus('正在收集诊断日志…', false);
      const tabs = await chrome.tabs.query({ url: ['*://www.youtube.com/*', '*://m.youtube.com/*'] });
      if (!tabs.length) {
        setStatus('未找到 YouTube 标签页，请先打开视频页面', true);
        return;
      }
      const tab = tabs.find((x) => x.active) || tabs[0];
      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'kt-debug-download' });
      const report = resp && resp.report;
      if (!report) {
        setStatus('获取失败：请刷新 YouTube 页面后重试（并确认已开启调试模式）', true);
        return;
      }
      const text = typeof report === 'string' ? report : JSON.stringify(report, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kt-debug-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('已下载诊断报告 ✓', false);
    } catch (e) {
      setStatus('获取失败：请刷新 YouTube 页面后重试（' + String((e && e.message) || e) + '）', true);
    }
  });

  $('feedback-open').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('feedback.html') });
  });

  const APPEARANCE_SCOPE = ['enabled','manualCaptions','targetLines','textSize','font','textColor','textOpacity','background','allCaps','textOutline','textBold','positionMode','position','posX','posY','captionWidth','widthPercent','tooltipFollowSubtitle','tooltip'];
  $('reset-appearance').addEventListener('click', () => {
    for (const k of APPEARANCE_SCOPE) settings[k] = deepClone(DEFAULT_SETTINGS[k]);
    render();
    save();
  });
}

async function init() {
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  fillTooltipSelects();

  try {
    const resp = await fetch(chrome.runtime.getURL('languages.json'));
    languages = await resp.json();
  } catch (e) { /* 语言表加载失败则只有 auto/英文 */ }
  fillLanguageSelects();

  try {
    const items = await chrome.storage.local.get({ [SETTINGS_KEY]: null });
    settings = normalizeSettings(items[SETTINGS_KEY]);
  } catch (e) {
    settings = deepClone(DEFAULT_SETTINGS);
  }

  uiLang = settings.uiLang;
  applyI18n();
  render();
  bind();
}

init();
