# 用户反馈接收端（Cloudflare Worker）

给「字幕整行翻译」Chrome 扩展接收用户反馈：**落库到 D1 + 推送到飞书群**。
代码里不含任何密钥（密钥用 `wrangler secret` 单独设置），可以安全入库。

## 需要准备

- Cloudflare 免费账号（**不用买域名、不用绑卡**）
- Node.js 18+（本机 WSL 里已有 v22）
- 一个飞书群 + 群里的「自定义机器人」（第 5 步再建）

## 部署步骤

```bash
cd tools/feedback-worker

# 1) 安装依赖（wrangler）
npm install

# 2) 登录 Cloudflare（会打开浏览器让你点「允许」；凭证只存在本机）
npx wrangler login

# 3) 创建 D1 数据库
npx wrangler d1 create kt-feedback
#    把输出里的 database_id 填进 wrangler.toml 的 REPLACE_WITH_YOUR_DATABASE_ID

# 4) 建表
npx wrangler d1 execute kt-feedback --remote --file=schema.sql

# 5) 设置密钥（逐个执行，回车后粘贴值再回车）
npx wrangler secret put IP_SALT          # 随便一段长随机串，用于限流哈希
npx wrangler secret put FEISHU_WEBHOOK   # 飞书机器人 webhook 地址
npx wrangler secret put FEISHU_SECRET    # 飞书「签名校验」密钥（开启签名后才有）

# 6) 部署
npx wrangler deploy
#    输出形如 https://kt-feedback.<你的子域>.workers.dev
#    这个地址要填进扩展的 src/manifest.json → host_permissions
```

## 自检

```bash
curl https://kt-feedback.<你的子域>.workers.dev/health
# {"ok":true,"service":"kt-feedback","count":0}
```

## 查看 / 管理反馈

```bash
# 最近 20 条
npx wrangler d1 execute kt-feedback --remote \
  --command "SELECT id, created_at, category, substr(content,1,60) AS content FROM feedback ORDER BY id DESC LIMIT 20"

# 没推送到飞书的（补看用）
npx wrangler d1 execute kt-feedback --remote \
  --command "SELECT id, created_at, deliver_error FROM feedback WHERE delivered = 0 ORDER BY id DESC LIMIT 20"

# 删除某条
npx wrangler d1 execute kt-feedback --remote --command "DELETE FROM feedback WHERE id = 1"

# 实时日志
npx wrangler tail
```

## 本地调试（可选）

```bash
# .dev.vars 里放本地用的密钥（已在 .gitignore 中，不会入库）
printf 'IP_SALT=dev\nFEISHU_WEBHOOK=\nFEISHU_SECRET=\n' > .dev.vars
npm run db:init:local
npm run dev
```

## 接口约定

| 方法 | 路径 | 说明 |
|---|---|---|
| `OPTIONS` | `*` | CORS 预检（返回 204） |
| `GET` | `/health` | 自检 |
| `POST` | `/` 或 `/feedback` | 接收反馈 |

请求体：

```jsonc
{
  "category": "bug",        // bug | idea | other（非法值按 other 处理）
  "content": "反馈正文",     // 必填，1–2000 字
  "diag": {                 // 可选：仅当用户主动勾选「附上诊断信息」时携带
    "extVersion": "0.3.0",
    "uiLang": "zh_CN",
    "ua": "Mozilla/5.0 ...",
    "videoUrl": "https://www.youtube.com/watch?v=xxx",
    "logs": ["...", "..."]  // 最近调试日志，最长 4000 字符
  }
}
```

响应：

| 场景 | HTTP | Body |
|---|---|---|
| 成功 | 200 | `{"ok":true,"id":123}` |
| 参数不合法 | 400 | `{"ok":false,"error":"invalid"}` |
| 正文超长 | 413 | `{"ok":false,"error":"too_long"}` |
| 触发限流 | 429 | `{"ok":false,"error":"rate_limited"}` |

## 行为说明

- **限流**：同一来源 60 秒最多 1 条；24 小时最多 30 条。只存 `sha256(IP + IP_SALT)`，不存原始 IP。
- **不丢反馈**：先写 D1，再推飞书；飞书失败仍返回 `ok`，并记 `delivered=0` + `deliver_error`。
- **保留期**：180 天，每天 UTC 03:00（北京 11:00）由 Cron 清理。
- **CORS**：`Access-Control-Allow-Origin: *`（无凭证请求）。
