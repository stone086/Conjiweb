# Conjiweb Native

非 Docker 原生安装版（VPS 直接安装）。

## 版本

- Native 版：`Conjiweb`（当前）
- Docker 版：`Conjiweb-Docker`

## 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/stone086/Conjiweb/main/install.sh | \
bash -s -- --repo https://github.com/stone086/Conjiweb.git --domain your-domain.com --email your-email@example.com
```

## 日常增量更新（推荐）

以后更新不要全量重装，直接：

```bash
cd /opt/conjiweb-src
bash manage.sh update
```

## 如果 `manage.sh` 报语法错误

先覆盖最新脚本再更新：

```bash
cd /opt/conjiweb-src
curl -fsSL https://raw.githubusercontent.com/stone086/Conjiweb/main/manage.sh -o manage.sh
sed -i 's/\r$//' manage.sh
chmod +x manage.sh
bash -n manage.sh
bash manage.sh update
```

## 常用命令

```bash
bash manage.sh status
bash manage.sh logs-api
bash manage.sh add-user
bash manage.sh backup
conjiweb-check your-domain.com
```

