# 本地运行指南（源码编译版）

编译产物已经就绪后的本地使用说明。两个产物：

- `dist/` — 前端（vite build 产物）
- `dist-server/` — 后端（tsc + tsc-alias 编译产物）

Express 后端会直接托管 `dist/` 下的静态文件，所以**只需要启动 server 一个进程**，不需要单独跑 vite。

## 1. 启动

```bash
npm run server        # 即 node dist-server/server/index.js
```

然后打开 **http://localhost:3001**（局域网内其他设备可访问 `http://<本机IP>:3001`，默认绑定 `0.0.0.0`）。

健康检查：`curl http://localhost:3001/health`

## 2. 首次使用

1. 打开 http://localhost:3001 会进入账号 Setup 页，创建第一个账号（用户名 ≥ 3 字符，密码 ≥ 6 字符）。
2. 账号存在 `~/.cloudcli/auth.db`，之后访问走登录。
3. 在项目列表里添加（或自动发现）你的代码目录，选择 provider（Claude / Codex / Cursor / OpenCode / ZCode）开始会话。

## 3. 可选配置

在仓库根目录放一个 `.env`（参考 `.env.example`），重启 server 生效。注意 `.env` 不是必需的，所有项都有默认值：

| 变量 | 默认 | 说明 |
|---|---|---|
| `SERVER_PORT` | `3001` | 后端 API + WebSocket + 静态文件端口 |
| `HOST` | `0.0.0.0` | 绑定地址；只想本机访问改为 `127.0.0.1` |
| `VITE_PORT` | `5173` | 仅开发模式（vite HMR）使用 |
| `DATABASE_PATH` | `~/.cloudcli/auth.db` | 账号/Token 数据库位置 |
| `CLAUDE_CLI_PATH` | `claude` | Claude CLI 自定义路径 |

## 4. Provider 依赖

Web UI 只是壳，各 provider 需要对应的 CLI 引擎，按需安装：

- **Claude** — 已安装 `claude` CLI 并登录
- **Codex / Cursor / OpenCode** — 对应 CLI 已安装
- **ZCode** — 需要安装 ZCode 桌面 App（引擎入口 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`），详见 `docs/zcode-provider-guide.md`

## 5. 重新编译

改了代码之后：

```bash
npm run build           # = build:client + build:server
npm run server
```

## 6. 开发模式（可选）

需要改代码并热更新时，不必先编译：

```bash
npm run dev             # tsx 跑 server(3001) + vite HMR(5173)
```

开发模式访问 **http://localhost:5173**（vite 代理 API 到 3001）。

## 7. 其他

- CLI 工具：`node dist-server/server/modules/cli/cli.js status` 查看配置和数据位置（`npm link` 之后可直接用 `cloudcli status`）。
- 运行时数据目录：`~/.cloudcli/`（auth.db、assets 上传、`local-server.json` 运行标记）。
- 桌面 App 壳（可选）：`npm run desktop:dev`（需要先跑 `npm run dev`，Electron 加载 vite 5173）。
