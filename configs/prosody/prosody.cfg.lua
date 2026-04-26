-- =============================================================================
-- Conjiweb Prosody config template
-- Placeholder XMPP_DOMAIN will be replaced by install.sh
-- =============================================================================

admins = { "admin@XMPP_DOMAIN" }

modules_enabled = {
  "roster";
  "saslauth";
  "tls";
  "dialback";
  "disco";
  "carbons";
  "pep";
  "private";
  "bookmarks";
  "blocklist";
  "http_upload";
  "vcard4";
  "vcard_legacy";
  "mam";
  "smacks";
  "csi";
  "websocket";
  "bosh";
  "http";
  "push";
  "cloud_notify";   -- XEP-0357 push relay (community module)
  "external_services"; -- XEP-0215 STUN/TURN credentials for Jingle
  "turn_external";  -- coturn integration
  "version";
  "uptime";
  "time";
  "ping";
  "register";
  "admin_adhoc";
}

modules_disabled = {}

allow_registration = false
c2s_require_encryption = true
s2s_require_encryption = true
s2s_secure_auth = false
authentication = "internal_hashed"
storage = "internal"

archive_expires_after = "3d"
default_archive_policy = true
max_archive_query_results = 100

-- Prosody 13 replacement for deprecated cross_domain_websocket
http_cors_override = "*"
consider_websocket_secure = true

http_interfaces = { "127.0.0.1" }
http_ports = { 5280 }
https_ports = {}

log = {
  info = "/var/log/prosody/prosody.log";
  error = "/var/log/prosody/prosody.err";
}

-- TURN/STUN configuration for Jingle calls (XEP-0215)
-- Install.sh fills TURN_SECRET; coturn config also uses it
turn_external_host = "turn.XMPP_DOMAIN"
turn_external_port = 3478
turn_external_secret = "TURN_SECRET_PLACEHOLDER"
turn_external_ttl = 86400

-- Push notification relay configuration
-- mod_cloud_notify forwards push notifications to the Conjiweb FastAPI backend,
-- which then dispatches them as Web Push to subscribed PWA clients.
push_notification_with_body = false  -- privacy: don't include message body in push
push_max_errors = 5
push_max_devices = 5

VirtualHost "XMPP_DOMAIN"
  authentication = "internal_hashed"

Component "conference.XMPP_DOMAIN" "muc"
  name = "Conjiweb Conference"
  modules_enabled = {
    "muc_mam";
  }
  restrict_room_creation = false
  max_history_messages = 100


-- =====================================================
-- Push notification appserver Component (Conjiweb custom relay)
-- See configs/prosody/mod_conjiweb_push.lua
-- =====================================================
Component "push.XMPP_DOMAIN"
  modules_enabled = { "conjiweb_push" }
  conjiweb_push_url = "http://127.0.0.1:8000/push/notify"
  conjiweb_push_secret = "PUSH_SHARED_SECRET_PLACEHOLDER"
