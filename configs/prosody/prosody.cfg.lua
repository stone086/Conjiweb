-- =============================================================================
--  Web Gajim V3 — Prosody XMPP 配置
--  针对 2GB VPS 内存优化
-- =============================================================================

-- 管理员（安装后通过 prosodyctl adduser 创建）
admins = { "admin@XMPP_DOMAIN" }

-- 模块
modules_enabled = {
  -- 核心
  "roster";           -- 联系人管理
  "saslauth";         -- 认证
  "tls";              -- TLS 加密
  "dialback";         -- 服务器间验证
  "disco";            -- 服务发现

  -- 功能
  "carbons";          -- 消息同步（多设备）
  "pep";              -- 个人发布（头像等）
  "private";          -- 私有数据
  "blocklist";        -- 拉黑
  "vcard4";           -- 名片
  "vcard_legacy";     -- 旧版名片兼容

  -- 消息归档（MAM）
  "mam";

  -- 状态
  "smacks";           -- 流管理（断线恢复）
  "csi_simple";       -- 客户端状态指示

  -- Web 连接
  "websocket";        -- WebSocket 支持
  "bosh";             -- BOSH 支持
  "http";

  -- 文件上传
  "http_upload";

  -- 工具
  "version";
  "uptime";
  "time";
  "ping";
  "register";         -- 用户注册（可关闭）
  "admin_adhoc";
}

-- 不启用的模块
modules_disabled = {}

-- 允许注册（改为 false 可关闭公开注册）
allow_registration = false

-- 加密要求
c2s_require_encryption = true
s2s_require_encryption = true
s2s_secure_auth = false

-- 存储后端
storage = "internal"

-- MAM 配置（消息归档）
archive_expires_after = "1y"    -- 保留 1 年
default_archive_policy = true   -- 默认开启归档
max_archive_query_results = 100

-- HTTP Upload 配置
http_upload_file_size_limit = 104857600  -- 100MB
http_upload_expire_after = 60 * 60 * 24 * 30  -- 30 天
http_upload_path = "/var/lib/prosody/http_uploads"

-- WebSocket 配置
cross_domain_websocket = true
consider_websocket_secure = true

-- HTTP 服务
http_interfaces = { "127.0.0.1" }
http_ports = { 5280 }
https_ports = {}  -- HTTPS 由 Nginx 处理

-- 内存优化（适合 2GB VPS）
-- 限制每个用户的连接数
-- max_client_idle_time = 3600

-- 日志
log = {
  info  = "/var/log/prosody/prosody.log";
  error = "/var/log/prosody/prosody.err";
}

-- =============================================================================
--  虚拟主机配置
-- =============================================================================

VirtualHost "XMPP_DOMAIN"
  authentication = "internal_hashed"

  -- SSL（由 Nginx 代理，Prosody 本身监听内部端口）
  -- 如果要让 Prosody 直接处理 TCP 5222 的 TLS：
  -- ssl = {
  --   certificate = "/etc/letsencrypt/live/XMPP_DOMAIN/fullchain.pem";
  --   key = "/etc/letsencrypt/live/XMPP_DOMAIN/privkey.pem";
  -- }

-- =============================================================================
--  MUC 群聊组件
-- =============================================================================

Component "conference.XMPP_DOMAIN" "muc"
  name = "Web Gajim V3 会议室"
  modules_enabled = {
    "muc_mam";          -- 群聊消息归档
    "muc_log";          -- 群聊日志
  }
  restrict_room_creation = false
  muc_log_by_default = true
  muc_log_expires_after = "1y"
  max_history_messages = 100

-- =============================================================================
--  HTTP Upload 组件
-- =============================================================================

Component "upload.XMPP_DOMAIN" "http_upload"
  http_upload_file_size_limit = 104857600
