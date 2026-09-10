'use strict';

/* 反馈页：类型 + 正文 +（可选）诊断信息 → POST 到 Cloudflare Worker → D1 落库 + 飞书通知。
 * 发送失败会暂存到 chrome.storage.local，下次打开自动填入并可重试。
 * 诊断信息默认不勾选；只有勾选时才向 YouTube 标签页取视频链接与最近日志。
 */

const WORKER_URL = 'https://kt-feedback.weijianluo114.workers.dev/';
const SETTINGS_KEY = 'ktSettings';
const QUEUE_KEY = 'ktFeedbackQueue';
const COOLDOWN_KEY = 'ktFeedbackCooldownUntil';
const MAX_CONTENT = 2000;
const COOLDOWN_MS = 60 * 1000;
const POST_TIMEOUT_MS = 20000;

const I18N = {
  zh_CN: {
    title: '反馈 / 建议',
    sub: '你的反馈会直接发给我，用来改进这个扩展。',
    cat: '类型',
    catBug: '问题反馈',
    catIdea: '功能建议',
    catOther: '其他',
    content: '内容',
    placeholder: '描述你遇到的问题，或想要的功能…（越具体越好，比如哪个视频、做了什么操作后出现）',
    diag: '附上诊断信息（可选）',
    diagHint: '包括扩展版本、浏览器版本、当前视频链接、最近 20 条调试日志。默认不勾选。',
    send: '发送',
    sending: '正在发送…',
    copy: '复制内容',
    copied: '已复制到剪贴板',
    ok: '已发送，谢谢！',
    errRate: '发送太频繁，请 1 分钟后再试',
    errLong: '内容太长（上限 2000 字）',
    errInvalid: '内容不能为空',
    errNet: '网络异常（已暂存到本机，下次打开可重试）',
    noEmpty: '请先写点内容',
    queueFound: '发现 1 条上次没发出去的反馈，已自动填入，点「发送」重试。',
    cooldown: '秒后可再次发送',
    hint: '匿名发送：不收集任何身份信息，不做用户标识。发送失败的反馈会暂存在本机，下次打开可重试。若网络一直不通，可点「复制内容」手动发给我。',
    copyHeader: '【字幕整行翻译 · 反馈】',
    copyCat: '类型',
    copyDiag: '诊断信息',
    copyNoDiag: '（未附带诊断信息）',
  },
  en: {
    title: 'Feedback / Suggestions',
    sub: 'Your feedback goes straight to the developer and helps improve this extension.',
    cat: 'Type',
    catBug: 'Bug report',
    catIdea: 'Feature request',
    catOther: 'Other',
    content: 'Message',
    placeholder: 'Describe the problem or the feature you want… (the more specific the better: which video, what you did)',
    diag: 'Attach diagnostics (optional)',
    diagHint: 'Extension version, browser version, current video link, last 20 debug logs. Unchecked by default.',
    send: 'Send',
    sending: 'Sending…',
    copy: 'Copy message',
    copied: 'Copied to clipboard',
    ok: 'Sent. Thank you!',
    errRate: 'Too frequent, please retry in a minute',
    errLong: 'Message too long (2000 chars max)',
    errInvalid: 'Message cannot be empty',
    errNet: 'Network error (saved locally, retry next time)',
    noEmpty: 'Please write something first',
    queueFound: 'One unsent feedback was found and filled in. Press Send to retry.',
    cooldown: 's until you can send again',
    hint: 'Sent anonymously: no identity data, no user identifier. Failed feedback is kept locally and can be retried. If the network stays unavailable, use "Copy message" and send it to the developer manually.',
    copyHeader: '[Subtitle Line Translator · Feedback]',
    copyCat: 'Type',
    copyDiag: 'Diagnostics',
    copyNoDiag: '(no diagnostics attached)',
  },
};

const $ = (id) => document.getElementById(id);

let uiLang = 'zh_CN';
let cooldownTimer = null;

const t = (key) => {
  const dict = I18N[uiLang] || I18N.zh_CN;
  return dict[key] || I18N.zh_CN[key] || key;
};

/* ------------------------------ 初始化 ------------------------------ */

async function init() {
  try {
    const items = await chrome.storage.local.get({ [SETTINGS_KEY]: null });
    const s = items[SETTINGS_KEY];
    if (s && s.uiLang) uiLang = s.uiLang;
  } catch (e) { /* 读取失败则用默认中文 */ }

  applyI18n();
  bindEvents();

  const store = await chrome.storage.local.get({ [QUEUE_KEY]: null, [COOLDOWN_KEY]: 0 });
  const queued = store[QUEUE_KEY];
  if (queued && queued.content) {
    $('content').value = queued.content;
    setCategory(queued.category || 'other');
    $('diag').checked = !!queued.diagChecked;
    setStatus(t('queueFound'), '');
  }
  updateCount();
  if (store[COOLDOWN_KEY]) startCooldown(store[COOLDOWN_KEY]);
  else updateSendEnabled();
}

function applyI18n() {
  document.documentElement.lang = uiLang === 'en' ? 'en' : 'zh-CN';
  const map = {
    't-title': 'title', 't-sub': 'sub', 't-cat': 'cat', 't-cat-bug': 'catBug',
    't-cat-idea': 'catIdea', 't-cat-other': 'catOther', 't-content': 'content',
    't-diag': 'diag', 't-diag-hint': 'diagHint', 't-hint': 'hint',
  };
  for (const [id, key] of Object.entries(map)) {
    const el = $(id);
    if (el) el.textContent = t(key);
  }
  $('content').placeholder = t('placeholder');
  $('send').textContent = t('send');
  $('copy').textContent = t('copy');
  document.title = t('title') + ' · ' + chrome.i18n.getMessage('extName');
}

/* ------------------------------ 事件 ------------------------------ */

function bindEvents() {
  document.querySelectorAll('.cat').forEach((label) => {
    label.addEventListener('click', () => {
      document.querySelectorAll('.cat').forEach((x) => x.classList.toggle('on', x === label));
      setTimeout(updateSendEnabled, 0);
    });
  });

  $('content').addEventListener('input', () => { updateCount(); updateSendEnabled(); });
  $('diag').addEventListener('change', updateSendEnabled);
  $('send').addEventListener('click', doSend);
  $('copy').addEventListener('click', doCopy);
}

function updateCount() {
  const n = $('content').value.length;
  $('count').textContent = String(n);
  $('count').style.color = n >= MAX_CONTENT ? '#d93025' : '';
}

function updateSendEnabled() {
  const busy = $('send').dataset.busy === '1';
  const cooling = $('send').dataset.cooling === '1';
  $('send').disabled = busy || cooling || !$('content').value.trim();
}

function setBusy(busy) {
  $('send').dataset.busy = busy ? '1' : '0';
  updateSendEnabled();
}

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text || '';
  el.className = kind || '';
}

function currentCategory() {
  const checked = document.querySelector('input[name="cat"]:checked');
  return checked ? checked.value : 'other';
}

function setCategory(value) {
  document.querySelectorAll('input[name="cat"]').forEach((input) => {
    input.checked = input.value === value;
    input.closest('.cat').classList.toggle('on', input.checked);
  });
}

/* ------------------------------ 发送 ------------------------------ */

async function doSend() {
  const content = $('content').value.trim();
  if (!content) { setStatus(t('noEmpty'), 'err'); return; }

  setBusy(true);
  setStatus(t('sending'), '');
  $('copy').classList.add('hidden');

  const payload = { category: currentCategory(), content };
  if ($('diag').checked) payload.diag = await collectDiag();

  try {
    const resp = await postJson(payload);
    if (resp && resp.ok) {
      await chrome.storage.local.remove([QUEUE_KEY]);
      const until = Date.now() + COOLDOWN_MS;
      await chrome.storage.local.set({ [COOLDOWN_KEY]: until });
      startCooldown(until);
      setStatus(t('ok'), 'ok');
      return;
    }
    const err = resp && resp.error;
    if (err === 'rate_limited') { setStatus(t('errRate'), 'err'); return; }
    if (err === 'too_long') { setStatus(t('errLong'), 'err'); return; }
    if (err === 'invalid') { setStatus(t('errInvalid'), 'err'); return; }
    throw new Error(err || 'unknown');
  } catch (e) {
    await chrome.storage.local.set({
      [QUEUE_KEY]: { category: payload.category, content: payload.content, diagChecked: $('diag').checked, at: Date.now() },
    });
    setStatus(t('errNet') + '（' + String((e && e.message) || e) + '）', 'err');
    $('copy').classList.remove('hidden');
  } finally {
    setBusy(false);
  }
}

async function postJson(payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS);
  try {
    const resp = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await resp.json(); } catch (e) { data = null; }
    if (!data) throw new Error('HTTP ' + resp.status);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* 只在用户勾选诊断信息时调用：向 YouTube 标签页取视频链接与最近日志 */
async function collectDiag() {
  const diag = {
    extVersion: chrome.runtime.getManifest().version,
    uiLang,
    ua: navigator.userAgent,
    videoUrl: '',
    logs: '',
  };
  try {
    const tabs = await chrome.tabs.query({
      url: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
      lastFocusedWindow: true,
    });
    const tab = tabs.find((x) => x.active) || tabs[0];
    if (tab && tab.id != null) {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'kt-feedback-collect' });
      if (resp && resp.ok) {
        if (resp.url) diag.videoUrl = resp.url;
        if (resp.uiLang) diag.uiLang = resp.uiLang;
        if (resp.logs) diag.logs = resp.logs;
      }
    }
  } catch (e) { /* 没有 YouTube 标签页 / 未注入：只发基础信息 */ }
  return diag;
}

/* ------------------------------ 复制兜底 ------------------------------ */

async function doCopy() {
  const text = buildCopyText({
    category: currentCategory(),
    content: $('content').value.trim(),
  });
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch (e2) { ok = false; }
  }
  setStatus(ok ? t('copied') : 'Copy failed', ok ? 'ok' : 'err');
}

function buildCopyText(payload) {
  const lines = [t('copyHeader'), t('copyCat') + ': ' + t(catKey(payload.category)), '', payload.content];
  if (payload.diag) {
    lines.push('', '--- ' + t('copyDiag') + ' ---');
    if (payload.diag.extVersion) lines.push('version: ' + payload.diag.extVersion);
    if (payload.diag.uiLang) lines.push('lang: ' + payload.diag.uiLang);
    if (payload.diag.videoUrl) lines.push('video: ' + payload.diag.videoUrl);
    if (payload.diag.ua) lines.push('ua: ' + payload.diag.ua);
    if (payload.diag.logs) lines.push('', payload.diag.logs);
  } else {
    lines.push('', t('copyNoDiag'));
  }
  return lines.join('\n');
}

function catKey(category) {
  if (category === 'bug') return 'catBug';
  if (category === 'idea') return 'catIdea';
  return 'catOther';
}

/* ------------------------------ 冷却 ------------------------------ */

function startCooldown(until) {
  if (cooldownTimer) clearInterval(cooldownTimer);
  const tick = () => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      $('send').dataset.cooling = '0';
      $('send').textContent = t('send');
      chrome.storage.local.remove([COOLDOWN_KEY]);
      updateSendEnabled();
      return;
    }
    $('send').dataset.cooling = '1';
    $('send').textContent = t('send') + ' (' + left + t('cooldown') + ')';
    updateSendEnabled();
  };
  tick();
  cooldownTimer = setInterval(tick, 1000);
}

init();
