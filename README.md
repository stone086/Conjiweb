# Conjiweb Native

非 Docker 原生安装版（VPS 直接安装）。

## 版本

- Native 版：`web_Conji_native`（当前）
- Docker 版：`web_Conji_Dock`

## 快速开始（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/stone086/Conjiweb/main/remote-install.sh | \
bash -s -- --repo https://github.com/stone086/Conjiweb.git --domain chat.yourdomain.com --email you@example.com
```

## SSH 私有仓库安装

```bash
cd /opt
git clone git@github.com:stone086/Conjiweb.git
cd Conjiweb
bash remote-install.sh --repo git@github.com:stone086/Conjiweb.git --domain chat.yourdomain.com --email you@example.com
```

## 安装后常用命令

```bash
bash manage.sh status
bash manage.sh logs-api
bash manage.sh add-user
bash manage.sh backup
```

## 连不上 GitHub

```bash
curl -I https://github.com
```

如果失败，先解决网络连通性再安装。
