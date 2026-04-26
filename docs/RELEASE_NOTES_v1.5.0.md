# Conjiweb v1.5.0 — 发布说明

发布日期：2026-04-22
代号：Enterprise + Killer Features

---

## 概览

v1.5.0 是 Conjiweb 从「自托管 XMPP 客户端」演变为「自托管 IM 平台」的里程碑版本。基于 v1.4.x 的协议层完整性，新增了一批面向企业和高级用户的功能。

总计本次升级周期（v1.2.0 → v1.5.0）新增：
- **9 个标准 XEP** 实现（Carbons / SM / CSI / PEP Avatar / Disco / Caps / 一致颜色 / Reactions / Push）
- **真 OMEMO**（XEP-0384 v0.8+，基于 libsignal，与 Conversations/Gajim 互通）
- **Jingle 音视频通话**（XEP-0166/0167/0176，含 coturn 自动安装）
- **PWA Push 通知**（XEP-0357 + Web Push，自托管 VAPID）
- **企业级集成**（OIDC SSO + LDAP）
- **群组通话**（mesh 拓扑）+ **屏幕共享** + **通话录制** + **语音消息**
- **AI 增强**（@ai 群聊助手 + 智能洞察 + 翻译 + 总结）
- **Webhooks** 入站消息推送
- **Slash 命令** 系统（可被插件扩展）
- **跨设备同步**（草稿/星标/置顶 via PEP）
- **链接预览**（OG 卡片 + SSRF 防护）
- **联系人备注 + 标签 + 元联系人**
- **本地全文搜索**（MiniSearch + IndexedDB）
- **管理面板**（活动 / Top 会话 / 存储 / 用户统计）
- **联邦化群组目录** + **服务器健康徽章**
- **OMEMO BTBV 信任 UI**

---

## 升级步骤

### 从 v1.4.x 升级

1. 备份当前安装：
   ```bash
   sudo /usr/local/bin/conjiweb-backup.sh
   ```

2. 替换源码：
   ```bash
   cd /opt
   sudo mv conjiweb conjiweb-old
   sudo unzip web_Conji_native_v1.5.0.zip
   sudo mv conjiweb_patched conjiweb
   sudo chown -R conjiweb:conjiweb conjiweb
   ```

3. 安装新依赖：
   ```bash
   cd /opt/conjiweb/apps/api
   sudo -u conjiweb venv/bin/pip install -r requirements.txt
   cd /opt/conjiweb/apps/web
   sudo -u conjiweb npm install
   sudo -u conjiweb npm run build
   ```

4. 运行新迁移：
   ```bash
   cd /opt/conjiweb/apps/api
   sudo -u conjiweb venv/bin/alembic upgrade head
   ```

5. 部署 Prosody 推送模块：
   ```bash
   sudo cp /opt/conjiweb/configs/prosody/mod_conjiweb_push.lua \
     /usr/lib/prosody-modules/mod_conjiweb_push/mod_conjiweb_push.lua
   sudo cp /opt/conjiweb/configs/prosody/prosody.cfg.lua /etc/prosody/
   ```

6. 配置环境变量（必须）：
   ```bash
   # /opt/conjiweb/apps/api/.env 中新增（如果还没有）：
   VAPID_PRIVATE_KEY=...
   VAPID_PUBLIC_KEY=...
   PUSH_SHARED_SECRET=...
   TURN_SECRET=...
   ```

7. 重启服务：
   ```bash
   sudo systemctl restart prosody conjiweb-api conjiweb-web
   ```

### 全新安装

直接运行 `install.sh`，所有上述步骤会自动完成。

---

## 功能验证清单

### 协议层

- [ ] 在 Conjiweb 上发消息，在手机 Conversations 上看到（Carbons 工作）
- [ ] 网络切换/断开重连，消息不丢失（SM 工作）
- [ ] 上传头像后，Conversations 联系人卡片显示（PEP Avatar 工作）
- [ ] 消息中含 URL 自动出现卡片（链接预览工作）

### 通话

- [ ] Phone 按钮发起语音通话，对方收到振铃
- [ ] Video 按钮发起视频通话，画面正常
- [ ] 接听后能看到屏幕共享按钮
- [ ] 录制按钮点击后录制，再次点击下载 .webm 文件
- [ ] 挂断后双方都进入 ended 状态

### Push

- [ ] 设置→通知→开启 PWA 离线推送
- [ ] 关闭浏览器，对方发消息，桌面通知弹出
- [ ] 点击通知打开对应会话

### OMEMO

- [ ] 私聊开启 OMEMO 后能正常发送解密
- [ ] 信任面板显示对方设备指纹
- [ ] 验证后图标变为绿色盾牌
- [ ] 与 Conversations 客户端加密互通

### SSO/LDAP

- [ ] 登录页显示 SSO 按钮（如配置）
- [ ] 点击 OIDC 跳转到 Keycloak/Authentik
- [ ] LDAP 用户名密码登录成功
- [ ] 自动创建本地账号并连接 XMPP

### 全文搜索

- [ ] 全局搜索框输入关键词，瞬间出现结果
- [ ] 离线时仍能搜索到历史消息
- [ ] 搜索结果点击跳转到原消息

---

## 已知限制

- **群组通话**：mesh 拓扑下超过 6 人会出现卡顿。SFU 服务端实现已规划但未交付。
- **OMEMO 多设备**：同一账号登录 3+ 设备时，新设备需等待 ~2 分钟才能收到历史 OMEMO 消息（PEP devicelist 同步延迟）。
- **链接预览**：某些站点的反爬机制会拒绝 server-side fetch；这些 URL 不显示卡片。
- **元联系人**：当前仅本地存储，跨设备同步需要在 PEP 节点 `conjiweb:meta-contacts:v1` 实现（待）。

---

## 升级路径建议

如果从 v1.1.0 直接升级到 v1.5.0：
- 必须按顺序运行所有 alembic 迁移（0001 → 0003）
- 旧的 e2ee.ts 自定义协议会作为 fallback 保留，不会破坏旧消息
- 跨设备 PEP 节点会在第一次连接时自动创建

---

## 下一版（v1.6.0）规划

- SFU 服务端（基于 mediasoup 或 LiveKit）支持大型群组通话
- BTBV 自动新设备警告（peer devicelist 变化时通知）
- 元联系人跨设备同步
- AI 集成：基于本地消息历史的 RAG 问答
- 移动端原生 Capacitor 包装（iOS/Android）
