# 金山打红心 · 打黑心 Windows 客户端（Tauri 2）

基于 **Tauri 2 + Windows 原生 WebView2** 构建的轻量桌面客户端，直接复用 `apps/client` 牌桌界面与 `@jinshan/game-core` 规则核心，安装包约 **5–8 MB**。

## 桌面特性与 PC 操作习惯

- **完整同步新中式海派 UI 与玩法（v0.1.0）**：内置三套牌桌皮肤（墨韵/朱砂/夜蓝）、开屏落印动画、三曲离线茶室配乐（BGM）与拟真出牌音效、5 档发牌速度、队友/对手三档 AI 难度，以及**纯离线单机人机模式**（双击即玩，零网络零配置）。
- **原生长宽比与窗口记忆**：默认 `1280×800` 宽屏（最小 `960×600`），自动记忆上次关闭时的窗口位置、大小与最大化状态。
- **单实例防双开 & 后台任务栏提醒**：
  - 重复点击快捷方式自动唤醒已有窗口；
  - 窗口在后台/切屏时轮到自己叫主、反主、埋底或出牌，自动闪烁 Windows 任务栏图标并轻声提示；
  - 对局进行中点击「退出」或窗口右上角 `X` 会弹出二次确认，防止手滑掉线。
- **系统托盘菜单**：支持托盘一键显示窗口、切换全屏、重置默认窗口尺寸、退出游戏。
- **PC 扑克鼠标手感**（全部集成在统一「游戏设置」弹窗内，按 `F1` / `?` 随时打开）：
  - **区间拖动连选**：按住左键横向划牌实时预览选中区间，往回拖立即取消，松手确认；
  - **点击牌桌空白处**快速放下已选牌；
  - **双击手牌快速出牌**：双击单张或已选合法牌型直接打出（可在设置里开关）；
  - **右键行为可自选**：「清空选牌」（默认）或「直接出牌」（选好合法牌右键直接出）；
  - **单/双排记忆 & 牌面缩放**：`R` 切换单/双排并持久化，`Ctrl + / - / 0` 自由调节 85%~130% 牌面大小。
- **全流程键盘快捷键**：
  - `Enter` / `Space`：出牌 / 确认埋底 / 结算继续下一局 / 等待房准备或开局；
  - `H`：智能提示 / 智能选底；`Esc`：关闭弹窗或清空选牌；
  - `1`~`4`（叫分含 `5`=+5分）：快速叫主、反主、叫分、定主；`N` / `Backspace`：不叫/放弃反主；
  - **按住 `Tab`**：速览上一轮出牌（松手自动关闭）；`L` 固定开关上一轮；`S` 查分；`B` 庄家看底牌；`T` 托管；`M` 静音；`F11` 全屏。
- **免管理员安装**：NSIS 中文安装程序默认以当前用户模式安装，无需 UAC 提权。

## 本地开发与构建

### 环境要求（Windows 10 / 11）

1. **Node.js 22+**
2. **Rust stable**（安装 MSVC 工具链：`Visual Studio Build Tools` C++ 桌面开发组件）
3. Windows 11 及更新后的 Windows 10 已内置 **Edge WebView2 Runtime**（安装包也已配置自动按需引导下载）。

### 常用命令（仓库根目录执行）

```bash
# 1. 安装依赖
npm install

# 2. 启动游戏服务端（另一个终端，用于本地联机或单人 3 Bot 调试）
npm run start:server

# 3. 启动桌面客户端开发模式（热更新）
npm run dev:win

# 4. 构建 Windows 安装包（NSIS .exe）与独立可执行文件
npm run build:win
```

构建产物位置（在 Windows 上运行 `npm run build:win` 后）：

- **中文安装程序（推荐分发）**：`apps/windows/src-tauri/target/release/bundle/nsis/金山打红心_0.1.0_x64-setup.exe`
- **免安装单文件**：`apps/windows/src-tauri/target/release/jinshan-hongxin-windows.exe`

### 重新生成应用图标

图标与 `apps/client/public/icon.svg` 保持一致（翡翠牌桌 + 红心 5）：

```bash
npm --workspace=@jinshan/windows run icons
```

## 连接服务器说明

- 如果本机已运行 `npm run start:server`，打开客户端即自动直连 `http://127.0.0.1:3001`；
- 如需连接局域网或公网服务端，点击大厅右上角 **「服务器」**（或断连提示条中的 **「配置服务器」**），填写如 `http://192.168.1.88:3001` 并保存即可。

## GitHub Actions 自动出包

仓库已配置 [.github/workflows/build-windows.yml](../../.github/workflows/build-windows.yml)：

- 推送到 `feat/windows-client`、提交 PR 或在 GitHub Actions 页面手动触发 `workflow_dispatch`，均会自动在 `windows-latest` 环境编译并上传 **NSIS 安装包** 与 **便携免安装 ZIP**；
- 推送 `v*` 标签发版时，自动将安装包和便携版附带到 GitHub Release。
