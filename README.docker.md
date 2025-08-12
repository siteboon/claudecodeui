# Claude Code UI - Docker 部署指南

本项目支持完全容器化部署，包含Claude Code CLI、Python(uv)、Node.js等完整环境。

## 📋 系统要求

- Docker Engine 20.10+
- Docker Compose 2.0+
- 最少 2GB 可用内存
- 最少 5GB 可用磁盘空间

## 🚀 快速开始

### 1. 克隆项目
```bash
git clone https://github.com/JokerRun/claudecodeui.git
cd claudecodeui
git checkout feature/dockerize
```

### 2. 配置环境变量
```bash
# 复制环境配置文件
cp .env.docker .env.docker.local

# 编辑配置文件，添加你的API密钥
nano .env.docker.local
```

### 3. 启动开发环境
```bash
# 构建并启动容器
docker-compose up -d

# 查看日志
docker-compose logs -f claudecodeui
```

### 4. 访问应用
打开浏览器访问: http://localhost:3001

## 🏢 生产部署

### 使用生产配置
```bash
# 使用生产配置文件
docker-compose -f docker-compose.prod.yml up -d

# 或者同时启用Nginx反向代理
docker-compose -f docker-compose.prod.yml --profile nginx up -d
```

### 环境变量设置
```bash
# 设置必要的环境变量
export CLAUDE_API_KEY="your_claude_api_key"
export OPENAI_API_KEY="your_openai_api_key"
export PROJECTS_PATH="/path/to/your/projects"
```

## 📁 卷挂载说明

### 开发环境挂载
- `~/.claude` → `/home/nodejs/.claude` (Claude配置目录)
- `~/Projects` → `/home/nodejs/Projects` (项目文件目录)
- `./data/uploads` → `/app/uploads` (上传文件存储)
- `./data/db` → `/app/data` (数据库存储)

### 生产环境挂载
使用Docker命名卷确保数据持久化：
- `claude-config` → Claude配置
- `claudecodeui-uploads` → 上传文件
- `claudecodeui-db` → 应用数据

## 🔧 自定义配置

### 修改项目目录挂载
编辑 `docker-compose.yml`，修改projects目录映射：
```yaml
volumes:
  - /your/custom/projects/path:/home/nodejs/Projects:rw
```

### 添加环境变量
在 `docker-compose.yml` 中添加：
```yaml
environment:
  - CUSTOM_VAR=value
```

## 🛠️ 故障排除

### 检查容器状态
```bash
# 查看容器状态
docker-compose ps

# 查看详细日志
docker-compose logs claudecodeui

# 进入容器调试
docker-compose exec claudecodeui bash
```

### 常见问题

#### 1. Claude CLI认证失败
确保正确设置了CLAUDE_API_KEY环境变量：
```bash
docker-compose exec claudecodeui claude auth status
```

#### 2. 文件权限问题
检查挂载目录的权限：
```bash
# 修复权限
sudo chown -R 1001:1001 ~/.claude
sudo chmod -R 755 ~/Projects
```

#### 3. 内存不足
增加Docker内存限制或优化应用配置：
```bash
# 查看容器资源使用
docker stats claudecodeui_claudecodeui_1
```

### 性能优化
```bash
# 清理Docker缓存
docker system prune -a

# 重新构建镜像
docker-compose build --no-cache
```

## 🔒 安全考虑

### API密钥管理
- 使用Docker secrets（推荐生产环境）
- 使用环境变量文件（开发环境）
- 避免在Dockerfile中硬编码密钥

### 网络安全
- 使用Nginx反向代理
- 配置HTTPS证书
- 限制API请求频率

### 文件系统安全
- 限制容器用户权限
- 使用只读挂载（适用时）
- 定期备份重要数据

## 📊 监控和日志

### 健康检查
容器内置健康检查，访问：
```
http://localhost:3001/api/config
```

### 日志管理
```bash
# 查看实时日志
docker-compose logs -f

# 限制日志大小
# 已在docker-compose.prod.yml中配置
```

### 监控指标
- 容器资源使用: `docker stats`
- 应用健康状态: 健康检查端点
- 日志分析: Docker logs

## 🔄 更新部署

```bash
# 拉取最新代码
git pull origin feature/dockerize

# 重新构建并部署
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## 📞 支持

如遇问题，请：
1. 检查容器日志
2. 验证环境配置
3. 查看GitHub Issues
4. 创建新的Issue报告问题