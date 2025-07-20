#!/bin/bash

# Quick development environment permission fix
# Run this with: sudo bash deployment/scripts/quick-fix-dev.sh

echo "Quick fix for claudecodeui permissions in development environment"
echo "================================================================"

# Add to sudo without password
echo "claudecodeui ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/claudecodeui
sudo chmod 440 /etc/sudoers.d/claudecodeui

# Change shell to bash
sudo usermod -s /bin/bash claudecodeui

# Add to necessary groups
sudo usermod -aG sudo claudecodeui
sudo usermod -aG systemd-journal claudecodeui 2>/dev/null || true
sudo usermod -aG adm claudecodeui 2>/dev/null || true

# Fix home directory permissions
sudo mkdir -p /home/claudecodeui/.claude
sudo chown -R claudecodeui:claudecodeui /home/claudecodeui
sudo chmod 755 /home/claudecodeui

# Fix app directories if they exist
[ -d "/opt/claudecodeui" ] && sudo chown -R claudecodeui:claudecodeui /opt/claudecodeui
[ -d "/etc/claudecodeui" ] && sudo chown -R claudecodeui:claudecodeui /etc/claudecodeui
[ -d "/var/log/claudecodeui" ] && sudo chown -R claudecodeui:claudecodeui /var/log/claudecodeui

# Restart service if running
sudo systemctl restart claudecodeui 2>/dev/null || true

echo ""
echo "✅ Permissions fixed!"
echo ""
echo "Test with:"
echo "  sudo -u claudecodeui bash"
echo "  sudo -u claudecodeui sudo whoami"
echo ""
echo "⚠️  WARNING: claudecodeui now has full sudo access - DEV ONLY!"