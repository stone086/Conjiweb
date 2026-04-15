# 常见问题排查

## SSL 证书申请失败

**症状：** `certbot` 报错，证书申请不成功。

**原因 1：域名 DNS 未生效**
```bash
# 检查 DNS 是否指向你的 VPS
dig +short 你的域名
nslookup 你的域名
```
确认输出的 IP 和你的 VPS IP 一致。DNS 生效可能需要几分钟到 24 小时。

**原因 2：80 端口被占用**
```bash
ss -tlnp | grep :80
# 如果有其他进程占用，先停掉
```

**原因 3：防火墙没开 80 端口**
```bash
ufw allow 80/tcp
ufw allow 443/tcp
```

---

## API 启动失败

```bash
# 查看详细日志
journalctl -u webgajim-api -n 50 --no-pager

# 常见原因：数据库连不上
systemctl status postgresql

# 手动测试 API 启动
cd /opt/web-gajim-v3/api
source .env
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

---

## 数据库迁移失败

```bash
cd /opt/web-gajim-v3/api
source .env

# 查看当前迁移状态
.venv/bin/alembic current

# 重新运行迁移
.venv/bin/alembic upgrade head

# 如果迁移文件有问题，重建数据库（会丢失数据！）
sudo -u postgres psql -c "DROP DATABASE webgajim;"
sudo -u postgres psql -c "CREATE DATABASE webgajim OWNER webgajim;"
.venv/bin/alembic upgrade head
```

---

## XMPP 无法连接

**检查 Prosody 状态：**
```bash
systemctl status prosody
tail -20 /var/log/prosody/prosody.log
tail -20 /var/log/prosody/prosody.err
```

**测试 WebSocket 连接：**
```bash
# 检查 Prosody 是否在监听 5280
ss -tlnp | grep 5280

# 检查 Nginx 是否正确代理
curl -i https://你的域名/xmpp-websocket \
  -H "Upgrade: websocket" \
  -H "Connection: Upgrade"
```

**检查域名配置：**
确认 `prosody.cfg.lua` 里的 `VirtualHost` 域名和你登录时填的 JID 域名一致。
比如 JID 是 `alice@chat.example.com`，则 VirtualHost 应该是 `chat.example.com`。

---

## 前端白屏

```bash
# 检查 Nginx 日志
tail -20 /var/log/nginx/error.log

# 检查前端文件是否存在
ls /opt/web-gajim-v3/web/dist/

# 重新构建前端
bash manage.sh update-front
```

---

## MinIO 文件上传失败

```bash
# 检查 MinIO 状态
systemctl status minio

# 检查 bucket 是否存在
mc ls local/

# 重新创建 bucket
mc mb local/webgajim-files
mc anonymous set download local/webgajim-files
```

---

## 内存不足

```bash
# 查看内存使用
bash manage.sh mem-usage
free -h

# 启用 swap（2GB VPS 建议加 1GB swap）
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 查看所有服务日志

```bash
# API
journalctl -u webgajim-api -f

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

## 重置管理员密码

编辑 `/opt/web-gajim-v3/api/.env`，修改 `ADMIN_PASS=新密码`，然后：
```bash
systemctl restart webgajim-api
```

---

## 证书快到期了

```bash
# 查看证书到期时间
certbot certificates

# 手动续期
bash manage.sh ssl-renew

# 或直接
certbot renew --nginx
```

证书自动续期已配置（每天检查），通常不需要手动操作。
