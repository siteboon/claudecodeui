# 🐳 Docker Setup for Claude Code UI

This guide covers how to run Claude Code UI using Docker and Docker Compose for both development and production environments.

## 🚀 Quick Start

### 1. Prerequisites

- Docker and Docker Compose installed
- Git (to clone the repository)
- Anthropic API key (for Claude functionality)

### 2. Environment Setup

Copy the environment template and customize it:

```bash
cp .env.docker .env
```

Edit `.env` and set your configuration:

```bash
# Required: Your Anthropic API key
ANTHROPIC_API_KEY=sk-ant-your-api-key-here

# Optional: Default admin credentials (created on first startup)
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=your-secure-password

# Platform-specific paths (examples)
# macOS:
USER_HOME_DIR=/Users/yourusername
HOST_WORKSPACE_PATH=/Users/yourusername/Desktop

# Linux:
USER_HOME_DIR=/home/yourusername
HOST_WORKSPACE_PATH=/home/yourusername/Desktop

# Windows (use forward slashes):
USER_HOME_DIR=C:/Users/yourusername
HOST_WORKSPACE_PATH=C:/Users/yourusername/Desktop
```

**Note**: The `${HOME}` environment variable works automatically on macOS and Linux. Windows users should explicitly set paths.

### 3. Run with Docker Compose

**Development mode (with hot reload):**
```bash
docker compose -f docker-compose.dev.yml up
```

**Production mode:**
```bash
docker compose up -d
```

**Access the application:**
- Frontend: http://localhost:2009
- Backend API: http://localhost:2008

## 📁 File Structure

```
claudecodeui/
├── docker-compose.yml          # Production configuration
├── docker-compose.dev.yml      # Development configuration
├── Dockerfile                  # Production image
├── Dockerfile.dev             # Development image
├── .dockerignore              # Files to exclude from build
├── nginx.conf                 # Nginx reverse proxy config
├── .env.docker               # Environment template
└── DOCKER.md                 # This guide
```

## 🔧 Configuration Options

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `ANTHROPIC_API_KEY` | Your Claude API key | - | ✅ |
| `DEFAULT_ADMIN_USERNAME` | Initial admin user | `admin` | ❌ |
| `DEFAULT_ADMIN_PASSWORD` | Initial admin password | `change-me` | ❌ |
| `PORT` | Backend server port | `2008` | ❌ |
| `VITE_PORT` | Frontend dev server port | `2009` | ❌ |
| `JWT_SECRET` | JWT signing secret | auto-generated | ❌ |
| `USER_HOME_DIR` | Host user's home directory | `${HOME}` | ❌ |
| `WORKSPACE_PATH` | Internal workspace path | `/workspace` | ❌ |
| `HOST_WORKSPACE_PATH` | Host directory to mount | `${HOME}/Desktop` | ❌ |
| `CLAUDE_EXECUTABLE_PATH` | Custom Claude CLI path | `/usr/local/bin/claude` | ❌ |
| `CLAUDE_CONFIG_DIR` | Claude config directory | `${HOME}/.claude` | ❌ |
| `CLAUDE_CONFIG_FILE` | Claude config file | `${HOME}/.claude.json` | ❌ |

### Volume Mounts

- **Database persistence**: `./data:/app/data`
- **Project access**: `${HOST_WORKSPACE_PATH}:/workspace:ro`
- **Claude executable**: `${CLAUDE_PATH}:/usr/local/bin/claude:ro`

## 🛠️ Development Setup

### Hot Reload Development

```bash
# Start development environment
docker compose -f docker-compose.dev.yml up

# View logs
docker compose -f docker-compose.dev.yml logs -f

# Rebuild after dependency changes
docker compose -f docker-compose.dev.yml build
```

### Development Features

- 🔄 **Hot reload**: Changes to source files automatically refresh
- 📝 **Volume mounts**: Source code mounted for live editing
- 🐛 **Debug mode**: Detailed logging and error messages
- 🔧 **Dev tools**: All development dependencies included

### Debugging

```bash
# Enter the container
docker compose -f docker-compose.dev.yml exec app-dev bash

# Check application logs
docker compose -f docker-compose.dev.yml logs app-dev

# Monitor container stats
docker stats claude-code-ui-dev
```

## 🚀 Production Setup

### Production Deployment

```bash
# Build and start production services
docker compose up -d

# With Nginx reverse proxy
docker compose --profile production up -d
```

### Production Features

- 🏗️ **Multi-stage build**: Optimized image size
- 🔒 **Security**: Non-root user, minimal dependencies
- ⚡ **Performance**: Pre-built frontend, optimized Node.js
- 🔄 **Health checks**: Automatic service monitoring
- 🚦 **Nginx proxy**: Load balancing and SSL termination

### SSL/HTTPS Setup

1. Place SSL certificates in `./ssl/` directory:
```bash
mkdir ssl
cp your-cert.pem ssl/cert.pem
cp your-key.pem ssl/key.pem
```

2. Update `nginx.conf` to enable HTTPS
3. Set environment variables:
```bash
SSL_ENABLED=true
SSL_CERT_PATH=/etc/nginx/ssl/cert.pem
SSL_KEY_PATH=/etc/nginx/ssl/key.pem
```

## 📊 Monitoring & Health Checks

### Built-in Health Checks

```bash
# Check service health
docker compose ps

# Health check endpoint
curl http://localhost:2008/api/health
```

### Monitoring Commands

```bash
# Container stats
docker stats

# Application logs
docker compose logs -f app

# System resource usage
docker system df
```

## 🔐 Security Considerations

### Authentication Setup

The application creates a default admin user on first startup:

```bash
# Set secure credentials in .env
DEFAULT_ADMIN_USERNAME=your-admin
DEFAULT_ADMIN_PASSWORD=very-secure-password-here
```

### Network Security

- Services run on isolated Docker network
- Database stored in named volume
- Read-only workspace mounts
- Optional Nginx reverse proxy with rate limiting

### Environment Security

```bash
# Generate secure JWT secret
JWT_SECRET=$(openssl rand -base64 32)

# Use environment-specific configs
NODE_ENV=production
TRUST_PROXY=true  # if behind reverse proxy
```

## 📝 Usage Examples

### Basic Development Workflow

```bash
# 1. Clone and setup
git clone <repository>
cd claudecodeui
cp .env.docker .env

# 2. Edit .env with your API key
nano .env

# 3. Start development environment
docker compose -f docker-compose.dev.yml up

# 4. Access application at http://localhost:2009
```

### Production Deployment

```bash
# 1. Prepare environment
cp .env.docker .env
# Edit .env with production settings

# 2. Deploy with all services
docker compose --profile production up -d

# 3. Verify deployment
curl -f http://localhost/api/health
```

### Custom Claude CLI Integration

```bash
# Mount custom Claude installation
docker run -v /path/to/claude:/usr/local/bin/claude:ro \\
  -e CLAUDE_EXECUTABLE_PATH=/usr/local/bin/claude \\
  claude-code-ui
```

### Project Workspace Configuration

```bash
# Mount multiple project directories
docker compose run -v /home/user/projects:/workspace/projects:ro \\
  -v /opt/repos:/workspace/repos:ro \\
  app-dev
```

## 🌍 Cross-Platform Configuration

### Platform-Specific Paths

The Docker setup supports macOS, Linux, and Windows. Here's how to configure paths for each platform:

#### macOS
```bash
# Home directories typically start with /Users
USER_HOME_DIR=/Users/yourusername
HOST_WORKSPACE_PATH=/Users/yourusername/Desktop
CLAUDE_CONFIG_DIR=/Users/yourusername/.claude
```

#### Linux
```bash
# Home directories typically start with /home
USER_HOME_DIR=/home/yourusername
HOST_WORKSPACE_PATH=/home/yourusername/Desktop
CLAUDE_CONFIG_DIR=/home/yourusername/.claude
```

#### Windows
```bash
# Use forward slashes for Windows paths in Docker
USER_HOME_DIR=C:/Users/yourusername
HOST_WORKSPACE_PATH=C:/Users/yourusername/Desktop
CLAUDE_CONFIG_DIR=C:/Users/yourusername/.claude
```

### Automatic Path Detection

On macOS and Linux, you can use the `${HOME}` environment variable which automatically expands to your home directory:

```bash
# Works on macOS and Linux
USER_HOME_DIR=${HOME}
HOST_WORKSPACE_PATH=${HOME}/Desktop
CLAUDE_CONFIG_DIR=${HOME}/.claude
```

### Important Notes

1. **Volume Mounts**: The Docker containers map your host directories to standardized paths inside the container:
   - Your home directory → `/home/user` (development) or `/home/nodejs` (production)
   - Your workspace → `/workspace`
   - Claude config → `/home/user/.claude`

2. **Windows Users**: Always use forward slashes (`/`) instead of backslashes (`\`) in paths

3. **Custom Paths**: If your Claude configuration or projects are in non-standard locations, update the respective environment variables

## 🔧 Troubleshooting

### Common Issues

**Port conflicts:**
```bash
# Check what's using the ports
lsof -i :2008 -i :2009

# Use different ports
docker compose -f docker-compose.dev.yml down
# Edit .env to change PORT and VITE_PORT
docker compose -f docker-compose.dev.yml up
```

**Permission issues:**
```bash
# Fix data directory permissions
sudo chown -R 1001:1001 ./data

# Or run without volume mount
docker compose run --rm app-dev
```

**Claude CLI not found:**
```bash
# Install Claude CLI in container
docker compose exec app-dev npm install -g @anthropic-ai/claude-cli

# Or mount from host
# Add to docker-compose.yml volumes:
# - /usr/local/bin/claude:/usr/local/bin/claude:ro
```

### Logs & Debugging

```bash
# Application logs
docker compose logs -f app-dev

# Container inspection
docker inspect claude-code-ui-dev

# Network debugging
docker network ls
docker network inspect claudecodeui_claude-network-dev
```

### Performance Optimization

```bash
# Prune unused images
docker image prune -a

# Optimize build cache
docker compose build --no-cache

# Monitor resource usage
docker stats --no-stream
```

## 🆕 Updates & Maintenance

### Updating the Application

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml build
docker compose -f docker-compose.dev.yml up -d
```

### Database Backups

```bash
# Backup SQLite database
docker compose exec app-dev sqlite3 /app/server/database/auth.db ".backup backup.db"
docker cp claude-code-ui-dev:/app/backup.db ./backup-$(date +%Y%m%d).db

# Restore database
docker cp ./backup.db claude-code-ui-dev:/app/backup.db
docker compose exec app-dev sqlite3 /app/server/database/auth.db ".restore backup.db"
```

## 🤝 Support

- **Issues**: Report bugs and request features on GitHub
- **Documentation**: Check the main README.md for application details
- **Community**: Join discussions in the project's GitHub Discussions

---

## 📋 Quick Reference

### Useful Commands

```bash
# Development
docker compose -f docker-compose.dev.yml up -d     # Start dev environment
docker compose -f docker-compose.dev.yml logs -f   # View logs
docker compose -f docker-compose.dev.yml restart   # Restart services

# Production  
docker compose up -d                                # Start production
docker compose --profile production up -d          # With nginx
docker compose ps                                   # Check status
docker compose down                                 # Stop all services

# Maintenance
docker compose pull                                 # Update base images
docker system prune -a                             # Clean up space
docker compose build --no-cache                    # Force rebuild
```

### Health Check URLs

- Frontend: http://localhost:2009
- Backend API: http://localhost:2008/api/health
- WebSocket: ws://localhost:2008/ws

Happy coding with Claude! 🚀