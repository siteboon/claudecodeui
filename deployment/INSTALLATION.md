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

**Important**: There is no default username/password. You must create the first user account when you access the system for the first time.

1. Open your browser and navigate to `http://localhost:3002`
2. You will be prompted to create the first admin account:
   - Choose a username (minimum 3 characters)
   - Choose a password (minimum 6 characters)
3. After creating the account, login with your credentials
4. Configure your Claude CLI path (if not auto-detected)

### 3. Reset Account/Password (if needed)

#### Method 1: Use the Password Reset Script (Recommended)

```bash
# Run the password reset script
sudo /opt/claudecodeui/deployment/scripts/reset-password.sh

# Follow the prompts to:
# 1. Select the username
# 2. Enter and confirm new password
# The script will automatically hash the password and restart the service
```

#### Method 2: Complete Database Reset

```bash
# Stop the service
sudo systemctl stop claudecodeui

# Remove the database file
sudo rm /opt/claudecodeui/server/database/auth.db

# Start the service (a new database will be created)
sudo systemctl start claudecodeui

# Navigate to http://localhost:3002 and create a new account
```

#### Method 3: Manual Password Reset

```bash
# First, generate a bcrypt hash for your new password
cd /opt/claudecodeui
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-new-password', 12).then(hash => console.log(hash));"

# Connect to the database
sudo sqlite3 /opt/claudecodeui/server/database/auth.db

# View existing users
SELECT id, username FROM users;

# Update the password (replace 'admin' with your username and use the hash from above)
UPDATE users SET password_hash = '$2b$12$YourGeneratedHashHere' WHERE username = 'admin';

# Exit sqlite
.quit

# Restart the service
sudo systemctl restart claudecodeui
```

**Note**: The database column is `password_hash`, not `password`.

### 4. Security Setup

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

# Check error log
sudo tail -50 /var/log/claudecodeui/error.log

# Common fixes:
# 1. Port already in use
sudo lsof -i :3002

# 2. Permission issues
sudo chown -R claudecodeui:claudecodeui /opt/claudecodeui
sudo chown -R claudecodeui:claudecodeui /home/claudecodeui
sudo chmod 755 /opt/claudecodeui/server/database

# 3. Missing .env file
sudo bash -c 'cat > /opt/claudecodeui/.env << EOF
PORT=3002
NODE_ENV=production
EOF'
sudo chown claudecodeui:claudecodeui /opt/claudecodeui/.env
```

### Cannot access web interface

1. Check firewall settings
2. Verify service is running: `sudo systemctl status claudecodeui`
3. Check if port is listening: `sudo netstat -tlnp | grep 3002`
4. Clear browser cache or try incognito mode
5. Check nginx/apache proxy configuration (if used)

### Database errors

```bash
# Database is read-only
sudo chmod 664 /opt/claudecodeui/server/database/auth.db
sudo chown claudecodeui:claudecodeui /opt/claudecodeui/server/database/auth.db
sudo systemctl restart claudecodeui

# Database cannot be created
sudo mkdir -p /opt/claudecodeui/server/database
sudo chown -R claudecodeui:claudecodeui /opt/claudecodeui/server/database
sudo chmod 755 /opt/claudecodeui/server/database

# Complete database reset
sudo systemctl stop claudecodeui
sudo rm -f /opt/claudecodeui/server/database/auth.db
sudo systemctl start claudecodeui
```

### Registration fails with 500 error

This usually means database permission issues:

```bash
# Fix database permissions
sudo chown -R claudecodeui:claudecodeui /opt/claudecodeui/server/database
sudo chmod 755 /opt/claudecodeui/server/database
sudo chmod 664 /opt/claudecodeui/server/database/auth.db

# Restart service
sudo systemctl restart claudecodeui
```

### Static resources not loading

If CSS/JS files fail to load:

1. Clear browser cache completely
2. Try incognito/private browsing mode
3. Check service worker: Open DevTools → Application → Service Workers → Unregister
4. Force refresh: Ctrl+F5 (Windows/Linux) or Cmd+Shift+R (Mac)

## Support

- GitHub Issues: https://github.com/yourusername/claudecodeui/issues
- Documentation: https://github.com/yourusername/claudecodeui/wiki