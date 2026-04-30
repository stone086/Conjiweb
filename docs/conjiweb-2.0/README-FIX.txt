Conjiweb 2.0 Fix Patch

覆盖内容：
1. apps/web/src/services/xmppBridge.ts
   - 登录连接成功后，发布 libsignal 真实 OMEMO bundle，而不是旧 e2ee P-256 兼容 bundle。
   - 这样 Conversations/Gajim/Dino 才能用标准 OMEMO bundle 建立 session。

2. apps/web/src/services/xmppAdapter.ts
   - 修复 fetchOmemoBundle 里重复嵌套 <pubsub> 的错误。
   - 原来生成的是 <pubsub><pubsub><items/></pubsub></pubsub>，服务器可能无法返回 bundle。

3. check-buttons.cmd
   - 修复 UTF-8 BOM 导致的“锘緻echo off”乱码。

覆盖方法：
把本补丁包解压到 web_Conji_native_2.0 根目录，选择覆盖同名文件。

覆盖后运行：
  .\check-buttons.cmd
  cd apps\web
  npm run build
  npm run dev
