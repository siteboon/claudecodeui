#!/bin/bash

# Claude Code UI Permission Fix Script
# This script adds debug privileges to existing claudecodeui user
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

# Function to print colored output
print_message() {
    echo -e "${2}${1}${NC}"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   print_message "This script must be run as root (use sudo)" "$RED"
   exit 1
fi

print_message "================================================" "$BLUE"
print_message "Fixing claudecodeui permissions for debugging" "$BLUE"
print_message "================================================" "$BLUE"

# 1. Check if user exists
if ! id "$SERVICE_USER" &>/dev/null; then
    print_message "Error: User $SERVICE_USER does not exist!" "$RED"
    exit 1
fi

print_message "Found user: $SERVICE_USER" "$GREEN"

# 2. Change user shell to bash for debugging
print_message "Changing user shell to /bin/bash..." "$YELLOW"
usermod -s /bin/bash "$SERVICE_USER"

# 3. Add user to sudo group
print_message "Adding $SERVICE_USER to sudo group..." "$YELLOW"
usermod -aG sudo "$SERVICE_USER"

# 4. Configure passwordless sudo
print_message "Configuring passwordless sudo..." "$YELLOW"
echo "$SERVICE_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$SERVICE_USER
chmod 440 /etc/sudoers.d/$SERVICE_USER

# 5. Add user to system groups for debugging
print_message "Adding user to system groups..." "$YELLOW"
usermod -aG systemd-journal "$SERVICE_USER" 2>/dev/null || true
usermod -aG adm "$SERVICE_USER" 2>/dev/null || true

# 6. Fix directory permissions if they exist
if [ -d "$INSTALL_DIR" ]; then
    print_message "Fixing $INSTALL_DIR permissions..." "$YELLOW"
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
    chmod 755 "$INSTALL_DIR"
    
    if [ -d "$INSTALL_DIR/server/database" ]; then
        chmod 755 "$INSTALL_DIR/server/database"
    fi
fi

if [ -d "$CONFIG_DIR" ]; then
    print_message "Fixing $CONFIG_DIR permissions..." "$YELLOW"
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$CONFIG_DIR"
    chmod 755 "$CONFIG_DIR"
fi

if [ -d "$LOG_DIR" ]; then
    print_message "Fixing $LOG_DIR permissions..." "$YELLOW"
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$LOG_DIR"
    chmod 755 "$LOG_DIR"
fi

# 7. Fix home directory
print_message "Fixing home directory permissions..." "$YELLOW"
if [ -d "/home/$SERVICE_USER" ]; then
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "/home/$SERVICE_USER"
    chmod 755 "/home/$SERVICE_USER"
    
    # Ensure .claude directory exists with correct permissions
    mkdir -p "/home/$SERVICE_USER/.claude"
    chown "$SERVICE_USER:$SERVICE_GROUP" "/home/$SERVICE_USER/.claude"
    chmod 755 "/home/$SERVICE_USER/.claude"
fi

# 8. Create debug directory if app is installed
if [ -d "$INSTALL_DIR" ]; then
    print_message "Creating debug tools directory..." "$YELLOW"
    mkdir -p "$INSTALL_DIR/debug"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/debug"
    chmod 755 "$INSTALL_DIR/debug"
    
    # Create a simple test script
    cat > "$INSTALL_DIR/debug/test-permissions.sh" << 'EOF'
#!/bin/bash
echo "Testing permissions for user: $(whoami)"
echo "Groups: $(groups)"
echo "Can use sudo: $(sudo -n true 2>&1 && echo YES || echo NO)"
echo "Home directory: $HOME"
echo "Current directory: $(pwd)"
EOF
    chmod +x "$INSTALL_DIR/debug/test-permissions.sh"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/debug/test-permissions.sh"
fi

# 9. Restart service if it's running
if systemctl is-active --quiet claudecodeui.service 2>/dev/null; then
    print_message "Restarting claudecodeui service..." "$YELLOW"
    systemctl restart claudecodeui.service
    sleep 2
    if systemctl is-active --quiet claudecodeui.service; then
        print_message "Service restarted successfully" "$GREEN"
    else
        print_message "Service failed to restart. Check: journalctl -u claudecodeui" "$RED"
    fi
fi

# 10. Verify changes
print_message "\n================================================" "$GREEN"
print_message "Permission fix completed!" "$GREEN"
print_message "================================================" "$GREEN"

print_message "\nVerifying changes:" "$YELLOW"
echo -n "User shell: "
getent passwd "$SERVICE_USER" | cut -d: -f7

echo -n "User groups: "
groups "$SERVICE_USER"

echo -n "Sudo access: "
if [ -f "/etc/sudoers.d/$SERVICE_USER" ]; then
    echo "Configured (passwordless)"
else
    echo "Not configured"
fi

print_message "\n⚠️  SECURITY WARNING:" "$RED"
print_message "User $SERVICE_USER now has FULL SUDO access!" "$RED"
print_message "This should only be used for debugging!" "$RED"

print_message "\nTo test permissions:" "$YELLOW"
print_message "  sudo -u $SERVICE_USER bash" "$NC"
print_message "  sudo -u $SERVICE_USER sudo whoami" "$NC"

if [ -f "$INSTALL_DIR/debug/test-permissions.sh" ]; then
    print_message "  sudo -u $SERVICE_USER $INSTALL_DIR/debug/test-permissions.sh" "$NC"
fi

print_message "\nTo remove sudo access later:" "$YELLOW"
print_message "  sudo rm /etc/sudoers.d/$SERVICE_USER" "$NC"
print_message "  sudo gpasswd -d $SERVICE_USER sudo" "$NC"