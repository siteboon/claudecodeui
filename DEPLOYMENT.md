# CloudCLI FCC Server - Deployment Guide

## Quick Start

### Production Build
```bash
npm run build        # Builds frontend (dist/) and backend (dist-server/)
npm run start        # Build and start production server
```

## Deployment Options

### 1. Docker (Recommended)

**Build Docker Image:**
```bash
docker build -t cloudcli:latest .
```

**Run Container:**
```bash
docker run -d \
  --name cloudcli \
  -p 3001:3001 \
  -e NODE_ENV=production \
  -v /data:/root/.cloudcli \
  cloudcli:latest
```

**Docker Compose:**
```bash
docker-compose up -d
```

### 2. Node.js Server

**Prerequisites:**
- Node.js 22+
- npm/yarn

**Setup:**
```bash
npm install --production
npm run build
npm run server
```

**Environment Variables:**
```env
NODE_ENV=production
PORT=3001
DATABASE_PATH=/var/lib/cloudcli/database.db
CORS_ORIGIN=https://your-domain.com
```

### 3. Cloud Platforms

#### Vercel/Netlify (Frontend Only)
```bash
npm run build:client
# Deploy dist/ directory
```

#### Railway/Render (Full Stack)
```bash
# Select Node.js buildpack
# Set build command: npm run build
# Set start command: npm run server
```

#### AWS EC2/ECS
```bash
# Push Docker image to ECR
# Deploy container to ECS
# Configure load balancer on port 3001
```

### 4. Systemd Service (Linux)

**Create `/etc/systemd/system/cloudcli.service`:**
```ini
[Unit]
Description=CloudCLI Server
After=network.target

[Service]
Type=simple
User=cloudcli
WorkingDirectory=/opt/cloudcli
ExecStart=/usr/bin/npm run server
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable and Start:**
```bash
sudo systemctl enable cloudcli
sudo systemctl start cloudcli
```

## Production Checklist

- [ ] Build verified: `npm run build`
- [ ] Tests passing: `npm test` (270/270)
- [ ] TypeScript clean: `npm run typecheck`
- [ ] Linting clean: `npm run lint`
- [ ] Environment variables configured
- [ ] Database path writable
- [ ] Port 3001 accessible
- [ ] SSL/TLS certificate installed
- [ ] Monitoring configured
- [ ] Backup strategy in place
- [ ] Log rotation configured

## Build Artifacts

```
dist/              - Frontend production build (2.99 MB)
dist-server/       - Backend compiled code
node_modules/      - Production dependencies only
```

## Performance Optimization

- Gzip compression enabled (threshold: 1KB)
- Code splitting: 90+ chunks
- CSS minified: 36.58 KB (gzipped)
- Images optimized via Vite
- Service workers supported

## Monitoring & Health Checks

**Health Check Endpoint:**
```bash
curl http://localhost:3001/health
```

**Logs:**
```bash
# Docker
docker logs cloudcli

# Systemd
journalctl -u cloudcli -f
```

## Troubleshooting

**Port Already in Use:**
```bash
lsof -i :3001
kill -9 <PID>
```

**Database Issues:**
```bash
rm /root/.cloudcli/database.db
npm run start  # Recreates database
```

**Memory Issues:**
```bash
# Increase Node heap
NODE_OPTIONS="--max-old-space-size=2048" npm run server
```

## Version Information

- Node.js: 22+
- npm: 10+
- TypeScript: 5.9.3
- React: 18.2.0
- Express: 4.18.2

## Support

For issues or questions:
1. Check logs: `docker logs cloudcli` or `journalctl -u cloudcli`
2. Verify configuration in `.env`
3. Run health check endpoint
4. Review GitHub issues: https://github.com/sjbrenchley89/claudecodeui

---
Generated: 2026-08-26
