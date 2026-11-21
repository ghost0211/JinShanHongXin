# 《金山打红心》全栈技术架构设计

## 1. 总体目标与选型说明

面向**个人开发者 · 安卓手机 & 平板优先 · 支持局域网/公网联机与亲友免上架跨端凑局**：

- **Monorepo 全栈 TypeScript**：前后端与规则核心共用同一套 TypeScript 类型和规则引擎，彻底消除“客户端提示合法、服务端判定非法”或“算分/牌型双端不一致”的问题。
- **Web 牌桌（React + Vite + 高清 SVG 扑克 + PWA）+ 原生 Android APK 壳**：
  - 无需经过应用商店或微信小程序审核，编译出独立 `.apk` 即可直接安装到安卓手机与平板；
  - 同一份 Web 端直接作为 PWA 运行，亲友用 iPhone/iPad 浏览器扫码打开链接即可同桌联机。
- **Node.js 权威服务端 + `node:sqlite` + 内置机器人（Bot）**：
  - 单二进制/零外部数据库依赖（使用 Node 24 原生内置 `node:sqlite`），一台 1~2 核轻量主机或手机 Termux 本机即可随时启服联机。
  - 内置 Bot 与调试上帝视角，支持单人随时拉满 3 个 Bot 完整测试从 `2` 打到 `A` 的全流程。

---

## 2. Monorepo 目录规划

```text
JinShanHongXin/
├── docs/
│   ├── rules.md              # 权威规则规格书
│   └── architecture.md       # 本文档
├── packages/
│   ├── protocol/             # 共享 WebSocket 协议、卡牌与脱敏视图类型
│   └── game-core/            # 纯函数权威规则内核、状态机、Bot AI 与完备单测
└── apps/
    ├── server/               # Fastify + ws + node:sqlite 权威游戏服务端（阶段二）
    ├── client/               # React + Vite 横屏自适应牌桌与双排手牌交互（阶段三）
    └── android/              # Kotlin/Gradle 原生 WebView 沉浸式横屏 APK 壳（阶段四）
```

---

## 3. 核心架构原则

1. **规则引擎纯函数化（`packages/game-core`）**：
   - 零网络、零 DOM、零随机副作用依赖（洗牌支持注入 PRNG 种子）。
   - 所有对局迁移都通过 `applyAction(state, action)` 完成，返回不可变新状态与结构化事件日志，天然支持对局录像回放与断言验证。
2. **权威裁决 + 信息隔离防作弊**：
   - 发牌、洗牌、底牌保管与合法性校验最终以服务端 `game-core` 为准。
   - 通过 `getPlayerView(state, seat, debugOpenHands)` 严格裁剪发往客户端的 `PlayerView`：正常对局下其他玩家手牌与 10 张底牌（埋底后未结算前）永不下发。
3. **断线重连一帧恢复**：
   - 任意时刻客户端重连进入房间，服务端直接下发最新脱敏 `PlayerView` 快照，客户端全量同步状态。
4. **手机 / 平板 38~48 张手牌适配**：
   - 手机横屏紧凑区采用**主牌上排 + 副牌下排**的双排分区布局与**横向划屏连选**；
   - 平板宽屏保留更大牌距与左侧常驻记分进度条（标出 `40 / 120 / 180 / 240` 档位）与惩罚标记。

---

## 4. 四阶段开发路线图

- **阶段一（核心完成，随阶段二同步增强）**：搭建 Monorepo、编写规则与架构文档、完成 `@jinshan/protocol` 与 `@jinshan/game-core`（含 `打红心`/`打黑心` 双模式与 `510K` 规则）、Bot 初版及全覆盖测试。
- **阶段二（当前）**：搭建 `apps/server`（Node.js HTTP + `ws` WebSocket + `node:sqlite`），实现双模式房间、选座/换座、一键添 Bot、断线重连/托管、战绩存储、Debug 上帝视角与端到端联机测试。
- **阶段三（已完成）**：实现 `apps/client` 横屏自适应扑克桌面 UI、矢量大字牌面、划屏选牌、叫主/比牌反主/叫分/埋底/出牌提示、结算弹窗、Web Audio 音效与 PWA。
- **阶段四（已完成）**：封装 `apps/android` 原生 Android WebView 沉浸式横屏 APK 壳（虚拟本地域 `http://appassets.jinshan.local/` 加载离线资源、4 字节对齐与 v1/v2/v3 调试签名），支持在 Android Termux 本机与 Android Studio 双路径编译。
