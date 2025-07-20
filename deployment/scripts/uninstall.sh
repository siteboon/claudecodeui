#!/bin/bash

# Claude Code UI Uninstallation Script
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

# Function to print colored output
print_message() {
    echo -e "${2}${1}${NC}"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   print_message "This script must be run as root" "$RED"
   exit 1
fi

print_message "Starting Claude Code UI uninstallation..." "$YELLOW"

# 1. Stop and disable service
print_message "Stopping service..." "$YELLOW"
if systemctl is-active --quiet claudecodeui.service; then
    systemctl stop claudecodeui.service
fi

if systemctl is-enabled --quiet claudecodeui.service 2>/dev/null; then
    systemctl disable claudecodeui.service
fi

# 2. Remove systemd service file
print_message "Removing systemd service..." "$YELLOW"
rm -f /etc/systemd/system/claudecodeui.service
systemctl daemon-reload

# 3. Backup configuration and database
print_message "Creating backup..." "$YELLOW"
BACKUP_DIR="/tmp/claudecodeui-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [ -d "$CONFIG_DIR" ]; then
    cp -r "$CONFIG_DIR" "$BACKUP_DIR/"
fi

if [ -f "$INSTALL_DIR/server/database/auth.db" ]; then
    cp "$INSTALL_DIR/server/database/auth.db" "$BACKUP_DIR/"
fi

print_message "Backup created at: $BACKUP_DIR" "$GREEN"

# 4. Remove application files
print_message "Removing application files..." "$YELLOW"
rm -rf "$INSTALL_DIR"

# 5. Remove configuration (optional)
read -p "Remove configuration files? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$CONFIG_DIR"
    print_message "Configuration removed" "$YELLOW"
else
    print_message "Configuration preserved at: $CONFIG_DIR" "$YELLOW"
fi

# 6. Remove logs (optional)
read -p "Remove log files? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$LOG_DIR"
    print_message "Logs removed" "$YELLOW"
else
    print_message "Logs preserved at: $LOG_DIR" "$YELLOW"
fi

# 7. Remove service user (optional)
read -p "Remove service user '$SERVICE_USER'? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    userdel "$SERVICE_USER" 2>/dev/null || true
    print_message "User removed" "$YELLOW"
else
    print_message "User preserved" "$YELLOW"
fi

print_message "Uninstallation completed!" "$GREEN"
print_message "Backup available at: $BACKUP_DIR" "$GREEN"