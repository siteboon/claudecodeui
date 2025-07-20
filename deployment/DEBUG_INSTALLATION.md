# Claude Code UI Debug Installation Guide

## Overview

This guide describes the debug installation process that grants elevated privileges to the `claudecodeui` service user for comprehensive debugging capabilities.

## ⚠️ Security Warning

**This installation method is intended for DEVELOPMENT and DEBUGGING purposes only!**

The debug installation grants the following elevated privileges:
- Full sudo access without password
- Access to system logs and journal
- Network debugging capabilities
- Shell access (/bin/bash instead of /bin/false)

**DO NOT use this in production environments!**

## Installation Methods

### Method 1: Debug Installation Script (Recommended)

```bash
# Navigate to the extracted package directory
cd claudecodeui-*/

# Run the debug installation script
sudo ./deployment/scripts/install-debug.sh
```

This script will:
1. Run the standard installation
2. Add sudo privileges to the claudecodeui user
3. Install debug utilities
4. Configure extended permissions

### Method 2: Modified Standard Installation

The standard `install.sh` script has been modified to include debug privileges:

```bash
sudo ./deployment/scripts/install.sh
```

## Debug Utilities

After installation, the following debug utilities are available in `/opt/claudecodeui/debug/`:

### 1. debug-info.sh
Collects comprehensive debug information:
```bash
sudo -u claudecodeui /opt/claudecodeui/debug/debug-info.sh
```

### 2. restart-service.sh
Quick service restart:
```bash
/opt/claudecodeui/debug/restart-service.sh
```

### 3. watch-logs.sh
Real-time log monitoring:
```bash
/opt/claudecodeui/debug/watch-logs.sh
```

### 4. check-env.sh
Environment and configuration checker:
```bash
/opt/claudecodeui/debug/check-env.sh
```

### 5. become-claudecodeui.sh
Switch to service user for debugging:
```bash
/opt/claudecodeui/debug/become-claudecodeui.sh
```

## Debugging Commands

As the claudecodeui user has sudo privileges, you can:

```bash
# Switch to claudecodeui user
sudo -u claudecodeui bash

# Check service status
sudo systemctl status claudecodeui

# View logs
sudo journalctl -u claudecodeui -f

# Restart service
sudo systemctl restart claudecodeui

# Check network connections
sudo ss -tlnp | grep node

# Monitor system resources
sudo htop
```

## File Locations

- Installation directory: `/opt/claudecodeui/`
- Configuration: `/etc/claudecodeui/claudecodeui.conf`
- Logs: `/var/log/claudecodeui/`
- Database: `/opt/claudecodeui/server/database/auth.db`
- Debug tools: `/opt/claudecodeui/debug/`
- Sudo configuration: `/etc/sudoers.d/claudecodeui`

## Removing Debug Privileges

To convert a debug installation to production:

1. Remove sudo privileges:
   ```bash
   sudo rm /etc/sudoers.d/claudecodeui
   ```

2. Remove user from sudo group:
   ```bash
   sudo gpasswd -d claudecodeui sudo
   ```

3. Change shell to /bin/false:
   ```bash
   sudo usermod -s /bin/false claudecodeui
   ```

4. Remove debug directory:
   ```bash
   sudo rm -rf /opt/claudecodeui/debug
   ```

## Complete Uninstallation

To completely remove Claude Code UI including all debug components:

```bash
sudo /opt/claudecodeui/debug/uninstall-complete.sh
```

Or manually:
```bash
# Stop and disable service
sudo systemctl stop claudecodeui
sudo systemctl disable claudecodeui

# Remove all files
sudo rm -rf /opt/claudecodeui
sudo rm -rf /etc/claudecodeui
sudo rm -rf /var/log/claudecodeui
sudo rm -f /etc/systemd/system/claudecodeui.service
sudo rm -f /etc/sudoers.d/claudecodeui

# Remove user
sudo userdel -r claudecodeui

# Reload systemd
sudo systemctl daemon-reload
```

## Troubleshooting

### Service Won't Start
1. Check logs: `sudo journalctl -u claudecodeui -n 100`
2. Verify permissions: `ls -la /opt/claudecodeui/`
3. Check port availability: `sudo ss -tlnp | grep 3002`

### Permission Denied Errors
1. Verify user exists: `id claudecodeui`
2. Check sudo access: `sudo -u claudecodeui sudo -l`
3. Verify file ownership: `ls -la /opt/claudecodeui/server/`

### Database Issues
1. Check database permissions: `ls -la /opt/claudecodeui/server/database/`
2. Verify database integrity: `sudo -u claudecodeui sqlite3 /opt/claudecodeui/server/database/auth.db "SELECT name FROM sqlite_master WHERE type='table';"`

## Security Considerations

When using the debug installation:

1. **Never expose to internet** - Use only on local development machines
2. **Monitor access** - Regularly check logs for unauthorized access
3. **Remove when done** - Always remove debug privileges after debugging
4. **Use firewall** - Restrict access to localhost only:
   ```bash
   sudo ufw allow from 127.0.0.1 to any port 3002
   ```

## Support

For issues or questions:
- Check application logs: `/var/log/claudecodeui/`
- System logs: `journalctl -u claudecodeui`
- Debug info: `/opt/claudecodeui/debug/debug-info.sh`