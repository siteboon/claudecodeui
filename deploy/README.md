# CloudCLI 内部部署指南 (macOS)

## 概述

CloudCLI 是 Claude Code CLI 的 Web UI，提供浏览器中的代码对话界面。本文档说明如何在 macOS 上安装部署。

## 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | macOS 12+ (Monterey 及以上) |
| Node.js | >= 20 (推荐 LTS 22.x) |
| 磁盘空间 | >= 500 MB |
| 端口 | 3001 (可配置) |

## 安装步骤

### 1. 安装 Node.js（如果尚未安装）

```bash
# 使用 Homebrew
brew install node

# 验证
node -v   # 应 >= 20
npm -v
```

### 2. 一键安装

将 `cloudcli-deploy.tar.gz` 传到目标机器后：

```bash
# 解压部署包
tar xzf cloudcli-deploy.tar.gz
cd cloudcli-deploy

# 执行安装（需要 sudo）
sudo ./install.sh
```

安装脚本会自动完成：
- 检测 Node.js 版本
- 停止并卸载已有的官方 cloudcli
- 解压应用到 `/opt/cloudcli`
- 安装生产依赖 & 编译原生模块
- 创建全局 `cloudcli` 命令
- 配置 launchd 开机自启动
- 立即启动服务

### 3. 访问

安装完成后，浏览器访问：

```
http://localhost:3001
```

首次访问需要注册账号。

## 自定义端口

安装时指定端口：

```bash
sudo CLOUDCLI_PORT=8080 ./install.sh
```

安装后修改端口：

```bash
# 编辑配置
sudo vim /opt/cloudcli/.env
# 修改 SERVER_PORT=8080

# 重启服务
sudo launchctl kickstart -k system/com.cloudcli.server
```

## 服务管理

```bash
# 查看状态
cloudcli status

# 重启服务
sudo launchctl kickstart -k system/com.cloudcli.server

# 停止服务
sudo launchctl bootout system/com.cloudcli.server

# 启动服务
sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudcli.server.plist

# 查看日志
tail -f /var/log/cloudcli/cloudcli.log
tail -f /var/log/cloudcli/cloudcli-error.log
```

## 配置 Claude API 代理（copilot-api）

如使用 copilot-api 代理，在 `~/.claude/settings.json` 中配置：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4141"
  }
}
```

CloudCLI 会自动读取此配置，并从代理获取可用模型列表。

## 文件说明

| 路径 | 说明 |
|------|------|
| `/opt/cloudcli/` | 应用安装目录 |
| `/opt/cloudcli/.env` | 环境变量配置 |
| `~/.cloudcli/auth.db` | 用户认证数据库 (SQLite) |
| `/var/log/cloudcli/` | 服务日志 |
| `/Library/LaunchDaemons/com.cloudcli.server.plist` | 开机自启动配置 |
| `/usr/local/bin/cloudcli` | 全局命令 (符号链接) |

## 卸载

```bash
cd cloudcli-deploy
sudo ./uninstall.sh
```

卸载会移除应用、服务和日志，但保留 `~/.cloudcli/` 用户数据。

## 故障排查

### 端口被占用

```bash
lsof -i :3001
# 找到占用进程后 kill，或改用其他端口
```

### 服务启动失败

```bash
# 检查错误日志
cat /var/log/cloudcli/cloudcli-error.log

# 手动运行诊断
cd /opt/cloudcli && node server/cli.js start
```

### node-pty 错误

```bash
# 重新编译原生模块
cd /opt/cloudcli && npm rebuild node-pty
node scripts/fix-node-pty.js
```

### 重置密码

```bash
# 使用 node 重置 (替换 USERNAME 和 NEWPASS)
cd /opt/cloudcli && node -e "
const bcrypt = require('bcrypt');
const db = require('better-sqlite3')(process.env.HOME + '/.cloudcli/auth.db');
const hash = bcrypt.hashSync('NEWPASS', 12);
db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hash, 'USERNAME');
console.log('Done');
"
```
