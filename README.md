# Conjiweb 2.0 (OMEMO-first)

这个目录以 **1.5 的可部署工程** 为底座，目标是把前端加密链路升级为 **2.0 OMEMO 架构**。

## 当前架构（唯一主线）

```text
apps/api/                  后端 API
apps/web/                  前端主工程（生产可部署）
apps/web/src/omemo2/       2.0 OMEMO Core（新架构）
apps/web/src/services/omemo/ 1.5 兼容层（待逐步下线）
scripts/check-buttons.mjs  按钮联通检查脚本
```

> 已移除根目录并行样板（旧的 `src/`、`public/`、`tests/`），避免双架构并存导致误用。

## 常用命令（在仓库根目录运行）

```bash
npm run install:web
npm run dev
npm run check:buttons
npm run build
```

## 目标

1. 发送链路切到 `omemo2/OmemoCore.encryptMessage()`
2. 接收解密切到 `omemo2/OmemoCore.decryptMessage()`
3. 保持 UI 与部署脚本兼容，逐步下线旧 `services/omemo/*`

