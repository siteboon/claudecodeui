#!/bin/bash

# Claude Code UI Debug Installation Script
# This script installs claudecodeui with elevated privileges for debugging
set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="claudecodeui"
INSTALL_DIR="/opt/${APP_NAME}"
CONFIG_DIR="/etc/${APP_NAME}"
LOG_DIR="/var/log/${APP_NAME}"
SERVICE_USER="${APP_NAME}"
SERVICE_GROUP="${APP_NAME}"
DEBUG_DIR="$INSTALL_DIR/debug"

# Function to print colored output
print_message() {
    echo -e "${2}${1}${NC}"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   print_message "This script must be run as root" "$RED"
   exit 1
fi

print_message "================================================" "$BLUE"
print_message "Claude Code UI Debug Installation" "$BLUE"
print_message "⚠️  WARNING: This installation grants elevated" "$YELLOW"
print_message "   privileges for debugging purposes only!" "$YELLOW"
print_message "================================================" "$BLUE"

# Confirm installation
read -p "Continue with debug installation? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    print_message "Installation cancelled" "$RED"
    exit 1
fi

# Run the standard installation script first
print_message "Running standard installation..." "$YELLOW"
if [ -f "./deployment/scripts/install.sh" ]; then
    bash ./deployment/scripts/install.sh
else
    print_message "Standard install script not found!" "$RED"
    exit 1
fi

print_message "\nConfiguring additional debug capabilities..." "$YELLOW"

# Create debug utilities
print_message "Creating debug utilities..." "$YELLOW"
cat > "$DEBUG_DIR/debug-info.sh" << 'EOF'
#!/bin/bash
# Debug information collector for Claude Code UI

echo "=== Claude Code UI Debug Information ==="
echo "Date: $(date)"
echo "User: $(whoami)"
echo "Groups: $(groups)"
echo ""
echo "=== Service Status ==="
sudo systemctl status claudecodeui --no-pager
echo ""
echo "=== Recent Logs ==="
sudo journalctl -u claudecodeui -n 50 --no-pager
echo ""
echo "=== Port Usage ==="
sudo ss -tlnp | grep -E ':(3001|3002)'
echo ""
echo "=== Process Information ==="
ps aux | grep -E '(node|claudecodeui)' | grep -v grep
echo ""
echo "=== Directory Permissions ==="
ls -la /opt/claudecodeui/
ls -la /etc/claudecodeui/
ls -la /var/log/claudecodeui/
echo ""
echo "=== Database Status ==="
if [ -f "/opt/claudecodeui/server/database/auth.db" ]; then
    ls -la /opt/claudecodeui/server/database/auth.db
    echo "Database size: $(du -h /opt/claudecodeui/server/database/auth.db | cut -f1)"
fi
EOF

chmod +x "$DEBUG_DIR/debug-info.sh"
chown "$SERVICE_USER:$SERVICE_GROUP" "$DEBUG_DIR/debug-info.sh"

# Create service restart helper
cat > "$DEBUG_DIR/restart-service.sh" << 'EOF'
#!/bin/bash
# Quick service restart helper

echo "Restarting Claude Code UI service..."
sudo systemctl restart claudecodeui
sleep 2
sudo systemctl status claudecodeui --no-pager
EOF

chmod +x "$DEBUG_DIR/restart-service.sh"
chown "$SERVICE_USER:$SERVICE_GROUP" "$DEBUG_DIR/restart-service.sh"

# Create log viewer helper
cat > "$DEBUG_DIR/watch-logs.sh" << 'EOF'
#!/bin/bash
# Real-time log viewer

echo "Watching Claude Code UI logs (Ctrl+C to exit)..."
sudo journalctl -u claudecodeui -f
EOF

chmod +x "$DEBUG_DIR/watch-logs.sh"
chown "$SERVICE_USER:$SERVICE_GROUP" "$DEBUG_DIR/watch-logs.sh"

# Create environment checker
cat > "$DEBUG_DIR/check-env.sh" << 'EOF'
#!/bin/bash
# Environment and configuration checker

echo "=== Environment Variables ==="
env | grep -E '(CLAUDE|NODE|JWT|PORT)' | sort
echo ""
echo "=== Configuration Files ==="
if [ -f "/etc/claudecodeui/claudecodeui.conf" ]; then
    echo "Contents of /etc/claudecodeui/claudecodeui.conf:"
    sudo cat /etc/claudecodeui/claudecodeui.conf | grep -v JWT_SECRET
fi
echo ""
echo "=== Node.js Information ==="
node --version
npm --version
echo ""
echo "=== System Resources ==="
free -h
df -h /opt/claudecodeui
EOF

chmod +x "$DEBUG_DIR/check-env.sh"
chown "$SERVICE_USER:$SERVICE_GROUP" "$DEBUG_DIR/check-env.sh"

# Grant additional capabilities for network debugging
print_message "Granting network debugging capabilities..." "$YELLOW"
setcap 'cap_net_raw,cap_net_admin+eip' /usr/bin/ping 2>/dev/null || true
setcap 'cap_net_raw,cap_net_admin+eip' /usr/bin/tcpdump 2>/dev/null || true

# Create helper script for user switching
cat > "$DEBUG_DIR/become-claudecodeui.sh" << 'EOF'
#!/bin/bash
# Switch to claudecodeui user for debugging

echo "Switching to claudecodeui user..."
echo "Type 'exit' to return to root"
sudo -u claudecodeui bash
EOF

chmod +x "$DEBUG_DIR/become-claudecodeui.sh"

# Create comprehensive uninstall script
cat > "$DEBUG_DIR/uninstall-complete.sh" << 'EOF'
#!/bin/bash
# Complete uninstallation including debug components

echo "This will completely remove Claude Code UI including all debug components."
read -p "Are you sure? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Uninstall cancelled"
    exit 1
fi

# Stop service
sudo systemctl stop claudecodeui
sudo systemctl disable claudecodeui

# Remove files
sudo rm -rf /opt/claudecodeui
sudo rm -rf /etc/claudecodeui
sudo rm -rf /var/log/claudecodeui
sudo rm -f /etc/systemd/system/claudecodeui.service
sudo rm -f /etc/sudoers.d/claudecodeui

# Remove user
sudo userdel -r claudecodeui 2>/dev/null || true

# Reload systemd
sudo systemctl daemon-reload

echo "Uninstallation complete"
EOF

chmod +x "$DEBUG_DIR/uninstall-complete.sh"

# Summary
print_message "\n================================================" "$GREEN"
print_message "Debug Installation Complete!" "$GREEN"
print_message "================================================" "$GREEN"
print_message "\nDebug utilities installed in: $DEBUG_DIR" "$BLUE"
print_message "\nAvailable debug commands:" "$YELLOW"
print_message "  $DEBUG_DIR/debug-info.sh     - Collect debug information" "$NC"
print_message "  $DEBUG_DIR/restart-service.sh - Restart the service" "$NC"
print_message "  $DEBUG_DIR/watch-logs.sh     - Watch real-time logs" "$NC"
print_message "  $DEBUG_DIR/check-env.sh      - Check environment" "$NC"
print_message "  $DEBUG_DIR/become-claudecodeui.sh - Switch to service user" "$NC"
print_message "\nService user '$SERVICE_USER' has:" "$YELLOW"
print_message "  ✓ Full sudo access (NOPASSWD)" "$GREEN"
print_message "  ✓ Access to system logs" "$GREEN"
print_message "  ✓ Network debugging capabilities" "$GREEN"
print_message "\n⚠️  SECURITY WARNING:" "$RED"
print_message "This configuration is for DEBUGGING ONLY!" "$RED"
print_message "Do not use in production environments!" "$RED"
print_message "\nTo remove debug privileges:" "$YELLOW"
print_message "  sudo rm /etc/sudoers.d/$SERVICE_USER" "$NC"
print_message "\nTo completely uninstall:" "$YELLOW"
print_message "  $DEBUG_DIR/uninstall-complete.sh" "$NC"