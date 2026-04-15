-- =============================================================================
--  Conjiweb 鈥?Prosody XMPP 閰嶇疆
--  閽堝 2GB VPS 鍐呭瓨浼樺寲
-- =============================================================================

-- 绠＄悊鍛橈紙瀹夎鍚庨€氳繃 prosodyctl adduser 鍒涘缓锛?admins = { "admin@XMPP_DOMAIN" }

-- 妯″潡
modules_enabled = {
  -- 鏍稿績
  "roster";           -- 鑱旂郴浜虹鐞?  "saslauth";         -- 璁よ瘉
  "tls";              -- TLS 鍔犲瘑
  "dialback";         -- 鏈嶅姟鍣ㄩ棿楠岃瘉
  "disco";            -- 鏈嶅姟鍙戠幇

  -- 鍔熻兘
  "carbons";          -- 娑堟伅鍚屾锛堝璁惧锛?  "pep";              -- 涓汉鍙戝竷锛堝ご鍍忕瓑锛?  "private";          -- 绉佹湁鏁版嵁
  "blocklist";        -- 鎷夐粦
  "vcard4";           -- 鍚嶇墖
  "vcard_legacy";     -- 鏃х増鍚嶇墖鍏煎

  -- 娑堟伅褰掓。锛圡AM锛?  "mam";

  -- 鐘舵€?  "smacks";           -- 娴佺鐞嗭紙鏂嚎鎭㈠锛?  "csi_simple";       -- 瀹㈡埛绔姸鎬佹寚绀?
  -- Web 杩炴帴
  "websocket";        -- WebSocket 鏀寔
  "bosh";             -- BOSH 鏀寔
  "http";

  -- 鏂囦欢涓婁紶
  "http_upload";

  -- 宸ュ叿
  "version";
  "uptime";
  "time";
  "ping";
  "register";         -- 鐢ㄦ埛娉ㄥ唽锛堝彲鍏抽棴锛?  "admin_adhoc";
}

-- 涓嶅惎鐢ㄧ殑妯″潡
modules_disabled = {}

-- 鍏佽娉ㄥ唽锛堟敼涓?false 鍙叧闂叕寮€娉ㄥ唽锛?allow_registration = false

-- 鍔犲瘑瑕佹眰
c2s_require_encryption = true
s2s_require_encryption = true
s2s_secure_auth = false

-- 瀛樺偍鍚庣
storage = "internal"

-- MAM 閰嶇疆锛堟秷鎭綊妗ｏ級
archive_expires_after = "1y"    -- 淇濈暀 1 骞?default_archive_policy = true   -- 榛樿寮€鍚綊妗?max_archive_query_results = 100

-- HTTP Upload 閰嶇疆
http_upload_file_size_limit = 104857600  -- 100MB
http_upload_expire_after = 60 * 60 * 24 * 30  -- 30 澶?http_upload_path = "/var/lib/prosody/http_uploads"

-- WebSocket 閰嶇疆
cross_domain_websocket = true
consider_websocket_secure = true

-- HTTP 鏈嶅姟
http_interfaces = { "127.0.0.1" }
http_ports = { 5280 }
https_ports = {}  -- HTTPS 鐢?Nginx 澶勭悊

-- 鍐呭瓨浼樺寲锛堥€傚悎 2GB VPS锛?-- 闄愬埗姣忎釜鐢ㄦ埛鐨勮繛鎺ユ暟
-- max_client_idle_time = 3600

-- 鏃ュ織
log = {
  info  = "/var/log/prosody/prosody.log";
  error = "/var/log/prosody/prosody.err";
}

-- =============================================================================
--  铏氭嫙涓绘満閰嶇疆
-- =============================================================================

VirtualHost "XMPP_DOMAIN"
  authentication = "internal_hashed"

  -- SSL锛堢敱 Nginx 浠ｇ悊锛孭rosody 鏈韩鐩戝惉鍐呴儴绔彛锛?  -- 濡傛灉瑕佽 Prosody 鐩存帴澶勭悊 TCP 5222 鐨?TLS锛?  -- ssl = {
  --   certificate = "/etc/letsencrypt/live/XMPP_DOMAIN/fullchain.pem";
  --   key = "/etc/letsencrypt/live/XMPP_DOMAIN/privkey.pem";
  -- }

-- =============================================================================
--  MUC 缇よ亰缁勪欢
-- =============================================================================

Component "conference.XMPP_DOMAIN" "muc"
  name = "Conjiweb 浼氳瀹?
  modules_enabled = {
    "muc_mam";          -- 缇よ亰娑堟伅褰掓。
    "muc_log";          -- 缇よ亰鏃ュ織
  }
  restrict_room_creation = false
  muc_log_by_default = true
  muc_log_expires_after = "1y"
  max_history_messages = 100

-- =============================================================================
--  HTTP Upload 缁勪欢
-- =============================================================================

Component "upload.XMPP_DOMAIN" "http_upload"
  http_upload_file_size_limit = 104857600
