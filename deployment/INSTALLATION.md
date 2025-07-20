# Claude Code UI Installation Guide

## System Requirements

- **Operating System**: Linux, WSL, or macOS
- **Node.js**: Version 18 or higher
- **Memory**: Minimum 512MB RAM
- **Disk Space**: 500MB free space
- **Network**: Port 3002 available

## Installation Methods

### Option 1: Quick Install (Recommended)

Download and run the installer:

```bash
# Download the latest release
wget https://github.com/yourusername/claudecodeui/releases/latest/download/claudecodeui-linux-x64.tar.gz

# Extract the package
tar -xzf claudecodeui-linux-x64.tar.gz

# Run installer
cd claudecodeui-*-linux-x64
sudo ./deployment/scripts/install.sh
```

### Option 2: Install from Source

Clone and build from source:

```bash
# Clone repository
git clone https://github.com/yourusername/claudecodeui.git
cd claudecodeui

# Install dependencies
npm install

# Build package
npm run package

# Extract and install
cd build
tar -xzf claudecodeui-*-linux-x64.tar.gz
cd claudecodeui-*-linux-x64
sudo ./deployment/scripts/install.sh
```

### Option 3: Docker Installation

Using Docker:

```bash
# Pull the image
docker pull yourusername/claudecodeui:latest

# Run with docker-compose
wget https://raw.githubusercontent.com/yourusername/claudecodeui/main/deployment/docker-compose.production.yml
docker-compose -f docker-compose.production.yml up -d
```

## Post-Installation Setup

### 1. Verify Installation

Check if the service is running:

```bash
# Check service status
sudo systemctl status claudecodeui

# Test the health endpoint
curl http://localhost:3002/api/health
```

### 2. Initial Configuration

1. Open your browser and navigate to `http://localhost:3002`
2. Create your first admin account
3. Configure your Claude CLI path (if not auto-detected)

### 3. Security Setup

For production use:

```bash
# Generate new JWT secret
sudo sed -i "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -base64 32)/" /etc/claudecodeui/claudecodeui.conf

# Restart service
sudo systemctl restart claudecodeui
```

## Configuration Options

Edit `/etc/claudecodeui/claudecodeui.conf`:

```bash
# Server Configuration
PORT=3002                    # Web server port
NODE_ENV=production          # Environment mode

# Security
JWT_SECRET=<random-string>   # Authentication secret

# Database
DATABASE_PATH=/opt/claudecodeui/database/claudecodeui.db

# Logging
LOG_LEVEL=info              # Options: debug, info, warn, error
```

## Upgrading

To upgrade an existing installation:

```bash
# Stop the service
sudo systemctl stop claudecodeui

# Backup current installation
sudo cp -r /opt/claudecodeui /opt/claudecodeui.backup

# Download and extract new version
wget https://github.com/yourusername/claudecodeui/releases/latest/download/claudecodeui-linux-x64.tar.gz
tar -xzf claudecodeui-linux-x64.tar.gz

# Copy new files
sudo cp -r claudecodeui-*/dist /opt/claudecodeui/
sudo cp -r claudecodeui-*/server /opt/claudecodeui/
sudo cp -r claudecodeui-*/node_modules /opt/claudecodeui/

# Start the service
sudo systemctl start claudecodeui
```

## Uninstallation

To remove Claude Code UI:

```bash
sudo /opt/claudecodeui/deployment/scripts/uninstall.sh
```

This will:
- Stop and disable the service
- Create a backup of your data
- Remove application files
- Optionally remove configuration and logs

## Troubleshooting

### Service fails to start

```bash
# Check logs
sudo journalctl -u claudecodeui -n 100

# Common fixes:
# 1. Port already in use
sudo lsof -i :3002

# 2. Permission issues
sudo chown -R claudecodeui:claudecodeui /opt/claudecodeui
```

### Cannot access web interface

1. Check firewall settings
2. Verify service is running
3. Check nginx/apache proxy configuration (if used)

### Database errors

```bash
# Backup and reset database
sudo cp /opt/claudecodeui/database/claudecodeui.db /tmp/backup.db
sudo rm /opt/claudecodeui/database/claudecodeui.db
sudo systemctl restart claudecodeui
```

## Support

- GitHub Issues: https://github.com/yourusername/claudecodeui/issues
- Documentation: https://github.com/yourusername/claudecodeui/wiki