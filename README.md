# Web Gajim V3 — 非 Docker 原生安装版

针对 **Debian 12 · 2GB 内存 · 日本 VPS · root 用户** 优化。

## 快速开始

### 方式 A：从 GitHub 远程一键安装（推荐）

在你的 VPS 上直接执行：

```bash
curl -fsSL https://raw.githubusercontent.com/<你的GitHub用户名>/<你的仓库名>/main/remote-install.sh -o remote-install.sh
bash remote-install.sh \
  --repo https://github.com/<你的GitHub用户名>/<你的仓库名>.git \
  --domain chat.yourdomain.com \
  --email you@example.com
```

可选参数：

- `--branch`：指定分支（默认 `main`）
- `--path`：当项目不在仓库根目录时指定路径（例如 `web_Conji_native`）
- `--target`：源码拉取目录（默认 `/opt/web-gajim-v3-src`）

### 方式 B：离线上传安装

```bash
# 在本地电脑执行
scp web-gajim-v3-native.zip root@你的VPS_IP:/root/
```

### 第二步：解压

```bash
cd /root
unzip web-gajim-v3-native.zip
cd web-gajim-v3-native
```

### 第三步：填写配置

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

### 第四步：一键安装

```bash
bash install.sh
```

安装过程约 10-20 分钟，全程自动，不需要任何交互。

安装完成后会显示：
- 访问地址
- 管理员账号密码
- 数据库/Redis/MinIO 密码（请保存）

### 第五步：创建 XMPP 用户

```bash
bash manage.sh add-user
# 输入用户名，然后输入密码
```

### 第六步：登录

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
