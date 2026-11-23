# 协作与分支规范

本仓库由多个开发会话（人和 AI）并行开发，请严格按下面的流程，避免互相覆盖。

## 分支

| 分支 | 用途 | 谁能直接提交 |
|---|---|---|
| `main` | 正式发布版：可正常游玩、测试全过。每次合入打版本标签（`v0.1.0`…），APK 从这里构建。 | 不直接提交，只从 `dev` 合入；禁止强制推送、禁止删除 |
| `dev` | 日常集成分支，所有功能分支先合到这里验证。默认分支。 | 只合并功能分支，不在上面写新功能 |
| `feat/*` `fix/*` `rules/*` `chore/*` | 职责分支，从 `dev` 拉出，做完合回 `dev` 后删除。 | 各自会话 |

### 职责分支命名示例

- `feat/bot-ai`：机器人策略（`packages/game-core/src/bot*.ts`、`bench/`）
- `feat/ui-table`：牌桌界面（`apps/client`）
- `feat/server-room`：房间、联机、用户系统（`apps/server`）
- `feat/android-shell`：安卓壳与打包（`apps/android`）
- `rules/<主题>`：规则改动（`packages/game-core`、`docs/rules.md`），**必须带测试**
- `fix/<问题>`：修 bug，尽量带复现测试

## 开工与收工流程

```sh
# 开工：从最新的 dev 拉出自己的分支
git switch dev && git pull
git switch -c feat/bot-ai

# 开发中：小步提交
git add -A && git commit -m "feat(bot): ..."

# 收工：先同步 dev，跑测试，再合并回 dev
git fetch origin && git merge origin/dev     # 解决冲突
npm test                                     # 必须通过
git switch dev && git merge --no-ff feat/bot-ai
git push origin dev && git branch -d feat/bot-ai
```

发版：`dev` 验证通过后合入 `main`，打标签并推送：

```sh
git switch main && git merge --no-ff dev
git tag -a v0.1.0 -m "..." && git push origin main --tags
```

## 约定

1. **一个会话一个分支**，不要多个会话同时改同一个分支。
2. **按目录分工**：`packages/game-core` 规则与机器人，`apps/client` 界面，`apps/server` 服务端，`apps/android` 安卓壳。
3. **共用的 `packages/protocol` 一旦改动，单独提交并尽快合到 `dev`**，其他分支随即同步，否则会互相编译失败。
4. **合并进 `dev` 前必须 `npm test` 全过。** 服务端有个依赖时序的测试（最后一墩自动出牌），偶发失败时先重跑一次再排查。
5. 提交信息用 `类型(范围): 说明`，类型有 `feat` `fix` `rules` `test` `docs` `chore` `refactor`。
6. 不要提交 `node_modules`、`dist`、`*.apk`、`*.keystore`、`.env`（已在 `.gitignore`）。
7. 修改机器人后，用 `packages/game-core/bench/` 的对战平台量化对比，结果记入 `bench/README.md`。
