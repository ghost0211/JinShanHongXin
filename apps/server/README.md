# 服务端：注册邀请码

新账号只允许凭管理员签发的一次性邀请码注册，没有公开发码接口或开放注册开关。已有账号继续正常登录；不注册也可以用游客身份创建或加入房间。

## 管理员发码

在服务端主机上，用有权写入 SQLite 数据库的运维账号执行。以下命令从仓库根目录运行，使用与服务端相同的工作目录和 `DB_PATH`；未设置时使用 `./apps/server/data/jinshan.db`。需要先构建，并确保该数据库已由服务端创建；发码时无需停服。

```sh
npm run build:core
node apps/server/dist/create-invite.js
# 自定义有效期，并沿用服务端实际使用的数据库路径：
DB_PATH=/path/to/jinshan.db node apps/server/dist/create-invite.js --ttl-hours 48
```

命令成功时向标准输出打印一行 JSON，字段为 `code` 和 UTC 到期时间 `expiresAt`。默认有效期是 24 小时，可指定 1～720 整数小时。请只私下发送 `code` 给受邀人；不要把它放进链接、工单、共享终端记录或日志。数据库只保存摘要，不能查回原码；遗失或过期时请重新生成。

## 受邀人注册

在大厅依次选择 **登录 / 注册 → 邀请码注册**，粘贴邀请码并填写新账号信息。只有成功创建账号和登录会话后才会用掉该码；例如用户名已被占用时，可改用其他用户名并重试。已成功用过的码不能再次注册。

自行对接客户端时，把 `inviteCode` 与 `username`、`password` 及可选的 `nickname` 一起放入 `POST /api/auth/register` 的 JSON 请求体；不要把邀请码放入 URL，也不要记录认证请求体。跨不可信网络部署时应使用 HTTPS。
