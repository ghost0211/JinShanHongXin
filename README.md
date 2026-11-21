# 金山打红心 · 打黑心（安卓手机 / 平板联机纸牌）

上海金山特色三副牌扑克双模式游戏：**金山打红心（2 打 2 升级 · 21 张比牌反主）** 与 **金山打黑心（1 打 3 叫分 · 固定打 10）**，含完整 `510K` 规则与 `A=1` 连牌支持。

详细规则见 [docs/rules.md](docs/rules.md)，系统架构见 [docs/architecture.md](docs/architecture.md)。

---

## 目录结构

- `packages/protocol`：前后端共享 WebSocket 协议与脱敏视图类型
- `packages/game-core`：纯函数权威规则引擎、状态机、`510K` 校验与 Bot 机器人 AI
- `apps/server`：Node.js HTTP + WebSocket 联机房服与 `node:sqlite` 战绩库
- `apps/client`：React + Vite 响应式安卓手机/平板横屏牌桌（支持 PWA）
- `apps/android`：原生 Android 沉浸式横屏 WebView APK 壳与一键打包脚本

---

## 快速开始

### 1. 安装依赖与运行全部测试
```bash
npm install
npm test
```

### 2. 启动局域网联机服务端（含前端页面）
```bash
npm run start:server
```
启动后会打印局域网地址（例如 `http://192.168.x.x:3001`）：
- 安卓手机 / 平板 / iPhone 浏览器直接打开该地址即可同桌联机，也可点击“添加到主屏幕”以全屏 PWA 体验游玩；
- 单人测试时点击大厅 **「单人调试开局 (+3机器人)」** 即可一键进入 4 人对局并切换上帝视角查看四家明牌与 21 张比牌数。

### 3. 编译可安装的安卓 APK（支持手机与平板）
```bash
npm run build:apk
```
生成的签名安装包位于：
`apps/android/dist/jinshan-hongxin-debug.apk`

- 首次运行会自动缓存官方 Android API 35 `android.jar` 并生成本地调试签名证书；
- 安装到安卓手机或平板后，点击大厅右上角 **「服务器」** 填写局域网服务端地址（如 `http://192.168.x.x:3001`），如果在本机 Termux 同步启动了服务端，则默认直连 `127.0.0.1:3001`；
- `apps/android` 同时附带标准 Gradle 工程配置，可直接用 Android Studio 打开构建。
