# Conjiweb 2.0 OMEMO Core

这个目录由迁移脚本新增。

它不会删除 1.5 的 OMEMO 代码，而是作为 2.0 旁路核心：

- OmemoCore.ts：统一入口
- DeviceManager.ts：设备列表
- BundleManager.ts：bundle/prekey
- SessionManager.ts：session
- TrustManager.ts：信任
- OmemoEncryptor.ts：加密
- OmemoDecryptor.ts：解密
- OmemoXml.ts：XML 生成/解析

下一步：
1. 登录后初始化 OmemoCore。
2. 发送 OMEMO 消息时调用 OmemoCore.encryptMessage()。
3. 接收 OMEMO 消息时调用 OmemoCore.decryptMessage()。
4. 把 placeholder 的 Signal session 替换成真实 Signal/OMEMO 实现。
5. 把 placeholder 的 device/bundle 获取替换成真实 XMPP PubSub。
