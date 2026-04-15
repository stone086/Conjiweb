# Web Gajim V3 — 非 Docker 原生安装版

## 版本说明

本项目有两个版本，请按你的部署方式选择：

| 版本 | 目录/仓库标识 | 适用场景 |
|------|---------------|---------|
| Conjiweb Native（当前） | `web_Conji_native` | 单机 VPS、无需 Docker、希望最小资源占用 |
| Conjiweb Docker | `web_Conji_Dock` | 需要容器化部署、环境隔离、便于编排与迁移 |

> 当前仓库内容为 **Native 版本**。如果你要使用 Docker 版本，请切换到 `web_Conji_Dock` 对应仓库/目录。

## 快速开始

仓库地址：`https://github.com/stone086/Conjiweb`

### 安装前自检（建议先执行）

```bash
# 必须是 root
id -u

# 域名是否已解析到本机 IP
ping -c 2 github.com
curl -I https://github.com
```

### 方式 A：GitHub SSH 密钥登录安装（推荐，适合私有仓库）

先在 VPS 上确认 SSH 密钥可访问 GitHub：

```bash
ssh -T git@github.com
```

然后执行安装（仓库名已固定为 `Conjiweb`）：

```bash
cd /opt
git clone git@github.com:stone086/Conjiweb.git
cd Conjiweb
bash remote-install.sh \
  --repo git@github.com:stone086/Conjiweb.git \
  --domain chat.yourdomain.com \
  --email you@example.com
```

如果 VPS 对 `github.com:22` 不通，可使用 SSH 443 通道：

```bash
mkdir -p ~/.ssh
cat > ~/.ssh/config << 'EOF'
Host github.com
  HostName ssh.github.com
  Port 443
  User git
EOF
chmod 600 ~/.ssh/config
```

### 方式 B：GitHub HTTPS 安装（公开仓库更方便）

```bash
curl -fsSL https://raw.githubusercontent.com/stone086/Conjiweb/main/remote-install.sh -o remote-install.sh
bash remote-install.sh \
  --repo https://github.com/stone086/Conjiweb.git \
  --domain chat.yourdomain.com \
  --email you@example.com
```

### 一条命令安装（HTTPS）

```bash
curl -fsSL https://raw.githubusercontent.com/stone086/Conjiweb/main/remote-install.sh | \
bash -s -- --repo https://github.com/stone086/Conjiweb.git --domain chat.yourdomain.com --email you@example.com
```

### 方式 C：离线上传安装

```bash
# 在本地电脑执行
scp web-gajim-v3-native.zip root@你的VPS_IP:/root/
```

`remote-install.sh` 可选参数：

- `--branch`：指定分支（默认 `main`）
- `--path`：项目不在仓库根目录时指定路径（例如 `web_Conji_native`）
- `--target`：源码拉取目录（默认 `/opt/web-gajim-v3-src`）

### GitHub 拉取失败排查

如果出现 `Could not connect to github.com` 或 `Connection reset`：

```bash
curl -I https://github.com
```

- 若失败：说明服务器网络到 GitHub 不通（防火墙/运营商/地区网络限制），需换网络或配置代理。
- 若成功：再重试 `bash remote-install.sh ...`。

离线安装后续步骤：

### 步骤 1：解压

```bash
cd /root
unzip web-gajim-v3-native.zip
cd web-gajim-v3-native
```

### 步骤 2：填写配置

```bash
cp .env.example .env
nano .env
```

**必须填写的两项：**
```
DOMAIN=chat.yourdomain.com    # 你的域名
EMAIL=you@example.com          # 你的邮箱（用于 SSL）
```

其他密码留空，安装时自动随机生成。

> ⚠️ 安装前请确保你的域名 DNS 已经解析到这台 VPS 的 IP。
> 否则 SSL 证书申请会失败。

### 步骤 3：一键安装

```bash
bash install.sh
```

安装过程约 10-20 分钟，全程自动，不需要任何交互。

安装完成后会显示：
- 访问地址
- 管理员账号密码
- 数据库/Redis/MinIO 密码（请保存）

### 步骤 4：创建 XMPP 用户

```bash
bash manage.sh add-user
# 输入用户名，然后输入密码
```

### 步骤 5：登录

打开浏览器访问 `https://你的域名`，用刚创建的 XMPP 账号登录。

---

## 目录说明

```
web-gajim-v3-native/
├── install.sh              一键安装脚本
├── manage.sh               日常管理脚本
├── .env.example            环境变量模板
├── apps/
│   ├── api/                FastAPI 后端（从主项目复制）
│   └── web/                React 前端（从主项目复制）
├── configs/
│   ├── nginx/
│   │   └── webgajim.conf   Nginx HTTPS 配置
│   └── prosody/
│       └── prosody.cfg.lua Prosody XMPP 配置
└── docs/
    └── troubleshooting.md  常见问题排查
```

---

## 日常管理

```bash
bash manage.sh status        # 查看所有服务状态
bash manage.sh logs-api      # 查看后端日志
bash manage.sh logs-xmpp     # 查看 XMPP 日志
bash manage.sh add-user      # 添加 XMPP 用户
bash manage.sh backup        # 立即备份
bash manage.sh mem-usage     # 查看内存使用
bash manage.sh restart-api   # 重启后端
```

---

## 服务说明

| 服务 | 端口 | 管理命令 |
|------|------|---------|
| Nginx | 80, 443 | `systemctl restart nginx` |
| FastAPI | 127.0.0.1:8000 | `systemctl restart webgajim-api` |
| PostgreSQL | 127.0.0.1:5432 | `systemctl restart postgresql` |
| Redis | 127.0.0.1:6379 | `systemctl restart redis-server` |
| Prosody | 5222, 127.0.0.1:5280 | `systemctl restart prosody` |
| MinIO | 127.0.0.1:9000 | `systemctl restart minio` |

---

## 访问地址

- 前端：`https://你的域名`
- API 文档：`https://你的域名/api/docs`
- MinIO 控制台：`https://你的域名/minio-console/`

---

## 内存占用参考

安装完成后各服务内存占用：

```
PostgreSQL:   ~80MB
Redis:        ~30MB
Prosody:      ~50MB
MinIO:        ~150MB
FastAPI:      ~100MB
Nginx:        ~20MB
系统:         ~200MB
─────────────────────
合计:         ~630MB
剩余可用:     ~1.4GB
```

---

## 自动备份

安装后自动配置每天凌晨 3:00 备份，备份文件保存在 `/root/backups/`，保留 7 天。

手动备份：`bash manage.sh backup`

---

## 卸载

```bash
# 停止服务
systemctl stop webgajim-api nginx prosody minio redis-server

# 删除服务文件
rm /etc/systemd/system/webgajim-api.service
rm /etc/systemd/system/minio.service
systemctl daemon-reload

# 删除数据（谨慎！）
# sudo -u postgres psql -c "DROP DATABASE webgajim;"
# rm -rf /opt/web-gajim-v3
# rm -rf /data/minio
```
