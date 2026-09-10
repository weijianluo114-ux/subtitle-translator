-- 字幕整行翻译 · 用户反馈表
-- 执行：wrangler d1 execute kt-feedback --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS feedback (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT    NOT NULL,           -- ISO8601 UTC
  category      TEXT    NOT NULL,           -- bug | idea | other
  content       TEXT    NOT NULL,           -- 用户手写正文（≤2000 字）
  ext_version   TEXT,                       -- 可选诊断：扩展版本
  ui_lang       TEXT,                       -- 可选诊断：界面语言
  ua            TEXT,                       -- 可选诊断：浏览器 UA
  video_url     TEXT,                       -- 可选诊断：当前视频链接（用户主动勾选才有）
  logs          TEXT,                       -- 可选诊断：最近调试日志（截断 4000 字符）
  ip_hash       TEXT,                       -- sha256(IP + IP_SALT)，仅用于限流，不可逆
  country       TEXT,                       -- Cloudflare 提供的国家码，便于判断网络问题
  delivered     INTEGER NOT NULL DEFAULT 0, -- 是否已成功推送到飞书
  deliver_error TEXT                        -- 推送失败原因（便于补看）
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_rate    ON feedback(ip_hash, created_at DESC);
