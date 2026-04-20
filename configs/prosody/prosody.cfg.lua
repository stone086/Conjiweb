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

VirtualHost "XMPP_DOMAIN"
  authentication = "internal_hashed"

Component "conference.XMPP_DOMAIN" "muc"
  name = "Conjiweb Conference"
  modules_enabled = {
    "muc_mam";
  }
  restrict_room_creation = false
  max_history_messages = 100
