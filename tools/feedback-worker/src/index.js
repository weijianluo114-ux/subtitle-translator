/**
 * 字幕整行翻译 · 用户反馈接收端
 * Cloudflare Worker + D1 + 飞书群机器人通知
 *
 * 环境变量（用 `wrangler secret put` 设置，不要写进代码或仓库）：
 *   FEISHU_WEBHOOK  飞书自定义机器人 webhook 地址
 *   FEISHU_SECRET   飞书机器人「签名校验」密钥（建议开启）
 *   IP_SALT         限流哈希用的随机盐
 *
 * 路由：
 *   OPTIONS *          CORS 预检
 *   GET     /health    自检（返回累计反馈条数）
 *   POST    /          接收反馈
 *   POST    /feedback  同上（别名）
 */

const MAX_CONTENT = 2000; // 正文字数上限
const MAX_LOGS = 4000; // 日志字符上限
const RATE_WINDOW_SEC = 60; // 同一来源 60 秒内最多 1 条
const RATE_DAILY_MAX = 30; // 同一来源每 24 小时最多 30 条
const RETENTION_DAYS = 180; // 反馈保留天数（scheduled 清理）

const CATEGORIES = new Set(['bug', 'idea', 'other']);
const CATEGORY_LABEL = { bug: '问题反馈', idea: '功能建议', other: '其他' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (request.method === 'GET' && url.pathname === '/health') {
      try {
        const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM feedback').first();
        return json({ ok: true, service: 'kt-feedback', count: row ? row.c : 0 });
      } catch (err) {
        return json({ ok: false, error: 'db_unavailable', message: String(err).slice(0, 300) }, 500);
      }
    }

    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/feedback')) {
      return handleFeedback(request, env);
    }

    return json({ ok: false, error: 'not_found' }, 404);
  },

  /* 每日定时：清理超过保留期的反馈 */
  async scheduled(_event, env) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
    await env.DB.prepare('DELETE FROM feedback WHERE created_at < ?1').bind(cutoff).run();
  },
};

async function handleFeedback(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'invalid' }, 400);

  const category = CATEGORIES.has(body.category) ? body.category : 'other';
  const content = String(body.content || '').trim();
  if (!content) return json({ ok: false, error: 'invalid' }, 400);
  if (content.length > MAX_CONTENT) return json({ ok: false, error: 'too_long' }, 413);

  /* 诊断信息：只有用户主动勾选时才会带上来 */
  let diag = null;
  if (body.diag && typeof body.diag === 'object') {
    const logs = Array.isArray(body.diag.logs) ? body.diag.logs.join('\n') : body.diag.logs;
    diag = {
      extVersion: str(body.diag.extVersion, 32),
      uiLang: str(body.diag.uiLang, 16),
      ua: str(body.diag.ua, 300),
      videoUrl: str(body.diag.videoUrl, 300),
      logs: str(logs, MAX_LOGS),
    };
  }

  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const ipHash = await sha256Hex(ip + '|' + (env.IP_SALT || 'no-salt'));
  const now = new Date();

  /* 限流：60 秒 1 条 + 24 小时 30 条 */
  const since = new Date(now.getTime() - RATE_WINDOW_SEC * 1000).toISOString();
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM feedback WHERE ip_hash = ?1 AND created_at > ?2'
  )
    .bind(ipHash, since)
    .first();
  if (recent && recent.c >= 1) return json({ ok: false, error: 'rate_limited' }, 429);

  const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
  const daily = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM feedback WHERE ip_hash = ?1 AND created_at > ?2'
  )
    .bind(ipHash, dayAgo)
    .first();
  if (daily && daily.c >= RATE_DAILY_MAX) return json({ ok: false, error: 'rate_limited' }, 429);

  const country = (request.cf && request.cf.country) || null;

  /* 先落库：即使飞书挂了也不丢反馈 */
  const inserted = await env.DB.prepare(
    `INSERT INTO feedback
       (created_at, category, content, ext_version, ui_lang, ua, video_url, logs, ip_hash, country, delivered)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0)`
  )
    .bind(
      now.toISOString(),
      category,
      content,
      diag ? diag.extVersion : null,
      diag ? diag.uiLang : null,
      diag ? diag.ua : null,
      diag ? diag.videoUrl : null,
      diag ? diag.logs : null,
      ipHash,
      country
    )
    .run();

  const id = inserted.meta && inserted.meta.last_row_id != null ? inserted.meta.last_row_id : null;

  /* 转发飞书：失败只记录，不影响返回给用户的结果 */
  let delivered = 0;
  let deliverError = null;
  try {
    if (!env.FEISHU_WEBHOOK) throw new Error('FEISHU_WEBHOOK 未配置');
    await notifyFeishu(env, { id, category, content, diag, country, now });
    delivered = 1;
  } catch (err) {
    deliverError = String((err && err.message) || err).slice(0, 500);
  }

  if (id != null) {
    await env.DB.prepare('UPDATE feedback SET delivered = ?1, deliver_error = ?2 WHERE id = ?3')
      .bind(delivered, deliverError, id)
      .run();
  }

  return json({ ok: true, id });
}

/* ------------------------------ 飞书通知 ------------------------------ */

async function notifyFeishu(env, item) {
  const payload = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: 'blue',
        title: { tag: 'plain_text', content: `【字幕整行翻译 · 新反馈】#${item.id != null ? item.id : '-'}` },
      },
      elements: buildCardElements(item),
    },
  };

  if (env.FEISHU_SECRET) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    payload.timestamp = timestamp;
    payload.sign = await feishuSign(timestamp, env.FEISHU_SECRET);
  }

  const resp = await fetch(env.FEISHU_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`飞书 HTTP ${resp.status}: ${text.slice(0, 200)}`);

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* 非 JSON 响应：只要 HTTP 2xx 就当成功 */
  }
  if (data && data.code !== undefined && data.code !== 0) {
    throw new Error(`飞书 code=${data.code} msg=${data.msg || ''}`);
  }
  return true;
}

function buildCardElements({ category, content, diag, country, now }) {
  const els = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**分类**：${CATEGORY_LABEL[category] || category}\n**内容**：\n${clip(content, MAX_CONTENT)}`,
      },
    },
    { tag: 'hr' },
  ];

  const meta = [];
  if (diag) {
    if (diag.extVersion) meta.push(`版本：${diag.extVersion}`);
    if (diag.uiLang) meta.push(`界面语言：${diag.uiLang}`);
    if (country) meta.push(`地区：${country}`);
    if (diag.videoUrl) meta.push(`视频：${diag.videoUrl}`);
    if (diag.ua) meta.push(`UA：${diag.ua}`);
  }
  meta.push(`时间：${formatCST(now)}`);
  els.push({ tag: 'div', text: { tag: 'lark_md', content: meta.join('\n') } });

  if (diag && diag.logs) {
    els.push({ tag: 'hr' });
    els.push({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: '最近日志：\n' + clip(diag.logs, MAX_LOGS) }],
    });
  }
  return els;
}

/** 飞书签名：base64(HMAC-SHA256(key = `${timestamp}\n${secret}`, data = "")) */
async function feishuSign(timestamp, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(timestamp + '\n' + secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new Uint8Array(0));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/* ------------------------------ 小工具 ------------------------------ */

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function str(value, max) {
  if (value == null) return '';
  return String(value).slice(0, max);
}

function clip(text, max) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max) + '…(已截断)' : s;
}

function formatCST(date) {
  const t = new Date(date.getTime() + 8 * 3600 * 1000);
  return t.toISOString().replace('T', ' ').slice(0, 19) + ' (UTC+8)';
}
