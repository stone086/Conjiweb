# 甯歌闂鎺掓煡

## SSL 璇佷功鐢宠澶辫触

**鐥囩姸锛?* `certbot` 鎶ラ敊锛岃瘉涔︾敵璇蜂笉鎴愬姛銆?
**鍘熷洜 1锛氬煙鍚?DNS 鏈敓鏁?*
```bash
# 妫€鏌?DNS 鏄惁鎸囧悜浣犵殑 VPS
dig +short 浣犵殑鍩熷悕
nslookup 浣犵殑鍩熷悕
```
纭杈撳嚭鐨?IP 鍜屼綘鐨?VPS IP 涓€鑷淬€侱NS 鐢熸晥鍙兘闇€瑕佸嚑鍒嗛挓鍒?24 灏忔椂銆?
**鍘熷洜 2锛?0 绔彛琚崰鐢?*
```bash
ss -tlnp | grep :80
# 濡傛灉鏈夊叾浠栬繘绋嬪崰鐢紝鍏堝仠鎺?```

**鍘熷洜 3锛氶槻鐏娌″紑 80 绔彛**
```bash
ufw allow 80/tcp
ufw allow 443/tcp
```

---

## API 鍚姩澶辫触

```bash
# 鏌ョ湅璇︾粏鏃ュ織
journalctl -u conjiweb-api -n 50 --no-pager

# 甯歌鍘熷洜锛氭暟鎹簱杩炰笉涓?systemctl status postgresql

# 鎵嬪姩娴嬭瘯 API 鍚姩
cd /opt/conjiweb/api
source .env
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

---

## 鏁版嵁搴撹縼绉诲け璐?
```bash
cd /opt/conjiweb/api
source .env

# 鏌ョ湅褰撳墠杩佺Щ鐘舵€?.venv/bin/alembic current

# 閲嶆柊杩愯杩佺Щ
.venv/bin/alembic upgrade head

# 濡傛灉杩佺Щ鏂囦欢鏈夐棶棰橈紝閲嶅缓鏁版嵁搴擄紙浼氫涪澶辨暟鎹紒锛?sudo -u postgres psql -c "DROP DATABASE conjiweb;"
sudo -u postgres psql -c "CREATE DATABASE conjiweb OWNER conjiweb;"
.venv/bin/alembic upgrade head
```

---

## XMPP 鏃犳硶杩炴帴

**妫€鏌?Prosody 鐘舵€侊細**
```bash
systemctl status prosody
tail -20 /var/log/prosody/prosody.log
tail -20 /var/log/prosody/prosody.err
```

**娴嬭瘯 WebSocket 杩炴帴锛?*
```bash
# 妫€鏌?Prosody 鏄惁鍦ㄧ洃鍚?5280
ss -tlnp | grep 5280

# 妫€鏌?Nginx 鏄惁姝ｇ‘浠ｇ悊
curl -i https://浣犵殑鍩熷悕/xmpp-websocket \
  -H "Upgrade: websocket" \
  -H "Connection: Upgrade"
```

**妫€鏌ュ煙鍚嶉厤缃細**
纭 `prosody.cfg.lua` 閲岀殑 `VirtualHost` 鍩熷悕鍜屼綘鐧诲綍鏃跺～鐨?JID 鍩熷悕涓€鑷淬€?姣斿 JID 鏄?`alice@chat.example.com`锛屽垯 VirtualHost 搴旇鏄?`chat.example.com`銆?
---

## 鍓嶇鐧藉睆

```bash
# 妫€鏌?Nginx 鏃ュ織
tail -20 /var/log/nginx/error.log

# 妫€鏌ュ墠绔枃浠舵槸鍚﹀瓨鍦?ls /opt/conjiweb/web/dist/

# 閲嶆柊鏋勫缓鍓嶇
bash manage.sh update-front
```

---

## MinIO 鏂囦欢涓婁紶澶辫触

```bash
# 妫€鏌?MinIO 鐘舵€?systemctl status minio

# 妫€鏌?bucket 鏄惁瀛樺湪
mc ls local/

# 閲嶆柊鍒涘缓 bucket
mc mb local/conjiweb-files
mc anonymous set download local/conjiweb-files
```

---

## 鍐呭瓨涓嶈冻

```bash
# 鏌ョ湅鍐呭瓨浣跨敤
bash manage.sh mem-usage
free -h

# 鍚敤 swap锛?GB VPS 寤鸿鍔?1GB swap锛?fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 鏌ョ湅鎵€鏈夋湇鍔℃棩蹇?
```bash
# API
journalctl -u conjiweb-api -f

# Nginx
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# Prosody
tail -f /var/log/prosody/prosody.log

# PostgreSQL
journalctl -u postgresql -f

# Redis
journalctl -u redis-server -f

# MinIO
journalctl -u minio -f
```

---

## 閲嶇疆绠＄悊鍛樺瘑鐮?
缂栬緫 `/opt/conjiweb/api/.env`锛屼慨鏀?`ADMIN_PASS=鏂板瘑鐮乣锛岀劧鍚庯細
```bash
systemctl restart conjiweb-api
```

---

## 璇佷功蹇埌鏈熶簡

```bash
# 鏌ョ湅璇佷功鍒版湡鏃堕棿
certbot certificates

# 鎵嬪姩缁湡
bash manage.sh ssl-renew

# 鎴栫洿鎺?certbot renew --nginx
```

璇佷功鑷姩缁湡宸查厤缃紙姣忓ぉ妫€鏌ワ級锛岄€氬父涓嶉渶瑕佹墜鍔ㄦ搷浣溿€?