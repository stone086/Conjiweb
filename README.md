# Conjiweb Native

非 Docker 原生安装版（VPS 直接安装）。

## 版本

- Native 版：`Conjiweb`（当前）
- Docker 版：`Conjiweb-Docker`

## 快速开始（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/stone086/Conjiweb/main/install.sh | \
bash -s -- --repo https://github.com/stone086/Conjiweb.git --domain your-domain.com --email your-email@example.com
```

执行后会自动完成依赖安装、服务部署和 HTTPS 配置。

## 安装后常用命令

```bash
bash manage.sh status
bash manage.sh logs-api
bash manage.sh add-user
bash manage.sh backup
bash manage.sh update
conjiweb-check your-domain.com
```
