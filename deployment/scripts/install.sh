#!/bin/bash

# Claude Code UI Installation Script
set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="claudecodeui"
INSTALL_DIR="/opt/${APP_NAME}"
CONFIG_DIR="/etc/${APP_NAME}"
LOG_DIR="/var/log/${APP_NAME}"
SERVICE_USER="${APP_NAME}"
SERVICE_GROUP="${APP_NAME}"

# Function to print colored output
print_message() {
    echo -e "${2}${1}${NC}"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   print_message "This script must be run as root" "$RED"
   exit 1
fi

print_message "Starting Claude Code UI installation..." "$GREEN"

# 1. Create service user with sudo privileges
print_message "Creating service user with elevated privileges..." "$YELLOW"
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --create-home --shell /bin/bash "$SERVICE_USER"
    print_message "User $SERVICE_USER created" "$GREEN"
    
    # Add user to sudo group for debugging capabilities
    usermod -aG sudo "$SERVICE_USER"
    print_message "User $SERVICE_USER added to sudo group" "$GREEN"
    
    # Configure passwordless sudo for debugging
    echo "$SERVICE_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$SERVICE_USER
    chmod 440 /etc/sudoers.d/$SERVICE_USER
    print_message "Configured passwordless sudo for $SERVICE_USER" "$GREEN"
else
    print_message "User $SERVICE_USER already exists" "$YELLOW"
    # Ensure existing user has sudo privileges
    usermod -aG sudo "$SERVICE_USER"
    if [ ! -f "/etc/sudoers.d/$SERVICE_USER" ]; then
        echo "$SERVICE_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$SERVICE_USER
        chmod 440 /etc/sudoers.d/$SERVICE_USER
        print_message "Added sudo privileges to existing user" "$GREEN"
    fi
fi

# 2. Create directories
print_message "Creating directories..." "$YELLOW"
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$LOG_DIR"
mkdir -p "$INSTALL_DIR/server/database"
mkdir -p "/home/$SERVICE_USER/.claude/projects"

# 3. Copy application files
print_message "Copying application files..." "$YELLOW"
if [ -d "./dist" ]; then
    cp -r ./dist "$INSTALL_DIR/"
    cp -r ./server "$INSTALL_DIR/"
    cp -r ./node_modules "$INSTALL_DIR/"
    cp -r ./deployment "$INSTALL_DIR/"
    cp ./package.json "$INSTALL_DIR/"
else
    print_message "Error: Build files not found. Please run 'npm run build' first." "$RED"
    exit 1
fi

# 4. Set up configuration
print_message "Setting up configuration..." "$YELLOW"
if [ ! -f "$CONFIG_DIR/claudecodeui.conf" ]; then
    cat > "$CONFIG_DIR/claudecodeui.conf" << EOF
# Claude Code UI Configuration
PORT=3002
NODE_ENV=production
JWT_SECRET=$(openssl rand -base64 32)
DATABASE_PATH=$INSTALL_DIR/server/database/auth.db
LOG_LEVEL=info
EOF
    chmod 600 "$CONFIG_DIR/claudecodeui.conf"
fi

# Create .env file for the application
cat > "$INSTALL_DIR/.env" << EOF
PORT=3002
NODE_ENV=production
EOF

# 5. Set permissions with debugging access
print_message "Setting permissions with debugging capabilities..." "$YELLOW"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$LOG_DIR"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$CONFIG_DIR"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "/home/$SERVICE_USER"

# Ensure database directory has proper permissions
chmod 755 "$INSTALL_DIR/server/database"

# Set executable permissions for debugging tools
chmod +x "$INSTALL_DIR/server/index.js"
chmod +x "$INSTALL_DIR/deployment/scripts/"*.sh

# Create debug tools directory with full access
mkdir -p "$INSTALL_DIR/debug"
chown "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/debug"
chmod 755 "$INSTALL_DIR/debug"

# Grant access to system logs for debugging
usermod -aG systemd-journal "$SERVICE_USER"
usermod -aG adm "$SERVICE_USER"

print_message "Extended permissions configured for debugging" "$GREEN"

# 6. Install systemd service
print_message "Installing systemd service..." "$YELLOW"
cp ./deployment/systemd/claudecodeui.service /etc/systemd/system/
systemctl daemon-reload

# 7. Enable and start service
print_message "Enabling service..." "$YELLOW"
systemctl enable claudecodeui.service
systemctl start claudecodeui.service

# 8. Check service status
if systemctl is-active --quiet claudecodeui.service; then
    print_message "Installation complete! Service is running." "$GREEN"
    print_message "Access the application at: http://localhost:3002" "$GREEN"
    print_message "Check logs at: $LOG_DIR" "$YELLOW"
else
    print_message "Service failed to start. Check logs: journalctl -u claudecodeui" "$RED"
    exit 1
fi

print_message "Installation completed successfully!" "$GREEN"
print_message "⚠️  WARNING: claudecodeui user has been granted sudo privileges for debugging purposes." "$YELLOW"
print_message "This configuration is intended for development/debugging environments only." "$YELLOW"
print_message "For production use, consider removing sudo privileges from /etc/sudoers.d/$SERVICE_USER" "$YELLOW"