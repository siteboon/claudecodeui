# CloudCLI FCC Server - Docker Deployment Guide

**Version:** 1.37.2  
**Date:** 2026-08-26  
**Status:** Production Ready

---

## Quick Start (Docker)

### Prerequisites
- Docker 20.10+
- Docker Compose 2.0+ (optional, for compose deployment)
- 2GB RAM minimum
- 2GB disk space

### Option 1: Build & Run Manually

```bash
# 1. Clone the repository
cd /path/to/claudecodeui

# 2. Build the Docker image
docker build -t cloudcli:latest .

# 3. Create a directory for database persistence
mkdir -p /var/lib/cloudcli

# 4. Run the container (bind to localhost only, use Nginx reverse proxy for external access)
docker run -d \
  --name cloudcli-server \
  -p 127.0.0.1:3001:3001 \
  -e NODE_ENV=production \
  -e CORS_ORIGIN=https://your-domain.com \
  -v /var/lib/cloudcli:/var/lib/cloudcli \
  cloudcli:latest

# 5. Check if running
docker logs cloudcli-server
curl http://localhost:3001/health
```

### Option 2: Docker Compose (Recommended)

```bash
# 1. Create docker-compose.yml (see template below)
# 2. Create .env.production with your configuration
# 3. Run:

docker-compose -f docker-compose.yml up -d

# View logs:
docker-compose logs -f cloudcli

# Stop:
docker-compose down
```

---

## Docker Compose Template

Create `docker-compose.production.yml`:

```yaml
version: '3.8'

services:
  cloudcli:
    image: cloudcli:latest
    build:
      context: .
      dockerfile: Dockerfile
    container_name: cloudcli-server
    restart: unless-stopped
    ports:
      # Bind to localhost only when using Nginx reverse proxy for TLS termination
      - "127.0.0.1:3001:3001"
      # For remote proxy setup (not recommended for production), use:
      # - "3001:3001"
    environment:
      NODE_ENV: production
      SERVER_PORT: 3001
      HOST: 0.0.0.0
      DATABASE_PATH: /var/lib/cloudcli/database.db
      CORS_ORIGIN: ${CORS_ORIGIN:-https://your-domain.com}
      LOG_LEVEL: info
      FORCE_HTTPS: "false"
    volumes:
      # Persist database across container restarts
      - cloudcli-data:/var/lib/cloudcli
      # Optional: mount logs directory
      - cloudcli-logs:/app/logs
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s
    # Optional: resource limits
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G

volumes:
  cloudcli-data:
    driver: local
  cloudcli-logs:
    driver: local
```

### Running with Docker Compose

```bash
# Copy production env
cp .env.production .env

# Build and start
docker-compose -f docker-compose.production.yml up -d

# View logs
docker-compose -f docker-compose.production.yml logs -f

# Stop
docker-compose -f docker-compose.production.yml down

# Restart
docker-compose -f docker-compose.production.yml restart

# Update (rebuild image)
docker-compose -f docker-compose.production.yml up -d --build
```

---

## Production Configuration

### Environment Variables

Required (.env.production):
```env
NODE_ENV=production
SERVER_PORT=3001
HOST=0.0.0.0
DATABASE_PATH=/var/lib/cloudcli/database.db
CORS_ORIGIN=https://your-domain.com
```

Optional (API providers):
```env
OPENROUTER_API_KEY=sk-or-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

### Volume Mounts

Persistent data:
```bash
-v /var/lib/cloudcli:/var/lib/cloudcli  # Database persistence
-v /var/log/cloudcli:/app/logs          # Application logs
```

### Port Mapping

```bash
-p 3001:3001      # Main application port
# Optional: For development
-p 5173:5173      # Vite dev server (dev only)
```

---

## Nginx Reverse Proxy Setup

For production, use Nginx as a reverse proxy:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Compression
    gzip on;
    gzip_types text/plain text/css text/javascript application/json application/javascript;
    gzip_min_length 1024;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

---

## SSL/TLS Setup with Let's Encrypt

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --nginx -d your-domain.com

# Auto-renewal (cron job)
0 12 * * * /usr/bin/certbot renew --quiet
```

---

## Monitoring & Health Checks

### Health Endpoint
```bash
curl http://localhost:3001/health

# Expected response:
{
  "status": "ok",
  "timestamp": "2026-08-26T15:36:12.066Z",
  "installMode": "git",
  "version": "1.37.2"
}
```

### Docker Health Check Status
```bash
docker inspect cloudcli-server | grep -A 5 '"Health"'
```

### View Logs
```bash
# Real-time logs
docker logs -f cloudcli-server

# Last 100 lines
docker logs --tail 100 cloudcli-server

# With timestamps
docker logs -f --timestamps cloudcli-server
```

---

## Backup & Restore

### Backup Database (Bind Mount Deployment)
For deployments using bind mount (`-v /var/lib/cloudcli:/var/lib/cloudcli`):

```bash
# Stop container
docker stop cloudcli-server

# Backup bind-mounted database directory
sudo tar czf cloudcli-backup-$(date +%Y%m%d).tar.gz -C /var/lib/cloudcli .

# Restart
docker start cloudcli-server
```

### Restore Database (Bind Mount Deployment)
```bash
# Stop container
docker stop cloudcli-server

# Clear existing data
sudo rm -rf /var/lib/cloudcli/*

# Restore backup
sudo tar xzf cloudcli-backup-20260826.tar.gz -C /var/lib/cloudcli

# Restart
docker start cloudcli-server
```

### Backup Database (Docker Compose with Named Volume)
For deployments using named volume (`cloudcli-data:/var/lib/cloudcli`):

```bash
# Stop container
docker-compose down

# Backup named volume
docker run --rm -v cloudcli-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/cloudcli-backup.tar.gz -C /data .

# Restart
docker-compose up -d
```

### Restore Database (Docker Compose with Named Volume)
```bash
# Stop container
docker-compose down

# Clear existing data
docker run --rm -v cloudcli-data:/data alpine rm -rf /data/*

# Restore backup
docker run --rm -v cloudcli-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/cloudcli-backup.tar.gz -C /data

# Restart
docker-compose up -d
```

---

## Performance Tuning

### Memory Optimization
```bash
# Increase Node.js heap if needed
docker run -e NODE_OPTIONS="--max-old-space-size=2048" cloudcli:latest
```

### CPU Limits
```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 2G
```

### Connection Pooling
- Automatically configured
- Max connections: 10 (configurable)

---

## Troubleshooting

### Container Won't Start
```bash
# Check logs
docker logs cloudcli-server

# Common issues:
# - Port 3001 already in use: docker ps -a, docker kill <id>
# - Database permission: chmod 755 /var/lib/cloudcli
# - Memory: increase available RAM
```

### High Memory Usage
```bash
# Check usage
docker stats cloudcli-server

# Solutions:
# - Restart container: docker restart cloudcli-server
# - Increase limits: deploy.resources.limits.memory
# - Reduce context window: CONTEXT_WINDOW=100000
```

### WebSocket Connection Issues
```bash
# Verify WebSocket support (check Nginx config)
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### Database Locked
```bash
# Restart container to unlock database
docker restart cloudcli-server
```

---

## Security Best Practices

1. **Use Named Volumes**
   ```bash
   -v cloudcli-data:/var/lib/cloudcli
   ```

2. **Non-Root User**
   - Docker image already runs as nodejs user (UID 1001)

3. **Resource Limits**
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 2G
   ```

4. **Network Isolation**
   ```bash
   --network cloudcli-network
   ```

5. **Read-Only Filesystem (Optional)**
   ```bash
   --read-only --tmpfs /tmp
   ```

6. **Security Options**
   ```bash
   --cap-drop=ALL
   --cap-add=NET_BIND_SERVICE
   --security-opt=no-new-privileges
   ```

---

## Scaling & Load Balancing

### Multiple Instances

```yaml
services:
  cloudcli-1:
    image: cloudcli:latest
    ports:
      - "3001:3001"
    environment:
      SERVER_PORT: 3001
    volumes:
      - cloudcli-data:/var/lib/cloudcli

  cloudcli-2:
    image: cloudcli:latest
    ports:
      - "3002:3001"
    environment:
      SERVER_PORT: 3001
    volumes:
      - cloudcli-data:/var/lib/cloudcli

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - cloudcli-1
      - cloudcli-2
```

---

## Deployment Checklist

- [ ] Docker installed and running
- [ ] Repository cloned
- [ ] .env.production configured
- [ ] Database directory created and writable
- [ ] SSL certificates obtained
- [ ] Reverse proxy configured (Nginx)
- [ ] Health endpoint tested
- [ ] Logs monitored
- [ ] Database backup strategy in place
- [ ] Monitoring/alerting configured
- [ ] Security review completed

---

## Support & References

- **Official Docs:** See DEPLOYMENT.md
- **Docker Docs:** https://docs.docker.com/
- **Docker Compose:** https://docs.docker.com/compose/
- **Nginx Docs:** https://nginx.org/en/docs/
- **Let's Encrypt:** https://letsencrypt.org/

---

## Quick Reference Commands

```bash
# Build image
docker build -t cloudcli:latest .

# Run container
docker run -d -p 3001:3001 -v cloudcli-data:/var/lib/cloudcli cloudcli:latest

# Start services
docker-compose -f docker-compose.production.yml up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Restart
docker-compose restart

# Check health
curl http://localhost:3001/health

# SSH into container
docker exec -it cloudcli-server sh

# Update container
docker-compose up -d --build
```

---

**Generated:** 2026-08-26  
**Version:** 1.37.2  
**Status:** Production Ready ✅
