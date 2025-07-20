#!/bin/bash

# Claude Code UI Package Builder
set -e

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME="claudecodeui-${VERSION}-linux-x64"
BUILD_DIR="./build"
PACKAGE_DIR="${BUILD_DIR}/${PACKAGE_NAME}"

print_message() {
    echo -e "${2}${1}${NC}"
}

print_message "Building Claude Code UI v${VERSION} package..." "$GREEN"

# 1. Clean previous builds
print_message "Cleaning previous builds..." "$YELLOW"
rm -rf "$BUILD_DIR"
mkdir -p "$PACKAGE_DIR"

# 2. Build production assets
print_message "Building production assets..." "$YELLOW"
npm run build

# 3. Install production dependencies
print_message "Installing production dependencies..." "$YELLOW"
cp package.json package-lock.json "$PACKAGE_DIR/"
cd "$PACKAGE_DIR"
npm ci --production
cd -

# 4. Copy application files
print_message "Copying application files..." "$YELLOW"
cp -r dist "$PACKAGE_DIR/"
cp -r server "$PACKAGE_DIR/"
cp -r deployment "$PACKAGE_DIR/"

# 5. Create startup wrapper
print_message "Creating startup wrapper..." "$YELLOW"
cat > "$PACKAGE_DIR/claudecodeui" << 'EOF'
#!/bin/bash
# Claude Code UI Startup Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment if exists
if [ -f "/etc/claudecodeui/claudecodeui.conf" ]; then
    export $(grep -v '^#' /etc/claudecodeui/claudecodeui.conf | xargs)
fi

# Start the application
exec node server/index.js "$@"
EOF
chmod +x "$PACKAGE_DIR/claudecodeui"

# 6. Create README for package
cat > "$PACKAGE_DIR/README.md" << EOF
# Claude Code UI v${VERSION}

## Installation

1. Extract this package to a temporary directory
2. Run the installation script as root:
   \`\`\`bash
   sudo ./deployment/scripts/install.sh
   \`\`\`

## Configuration

Configuration file: \`/etc/claudecodeui/claudecodeui.conf\`

## Service Management

- Start: \`sudo systemctl start claudecodeui\`
- Stop: \`sudo systemctl stop claudecodeui\`
- Status: \`sudo systemctl status claudecodeui\`
- Logs: \`sudo journalctl -u claudecodeui -f\`

## Uninstallation

Run: \`sudo /opt/claudecodeui/deployment/scripts/uninstall.sh\`
EOF

# 7. Make scripts executable
chmod +x "$PACKAGE_DIR/deployment/scripts/"*.sh

# 8. Create tarball
print_message "Creating package archive..." "$YELLOW"
cd "$BUILD_DIR"
tar -czf "${PACKAGE_NAME}.tar.gz" "$PACKAGE_NAME"
cd -

# 9. Create checksum
print_message "Generating checksum..." "$YELLOW"
cd "$BUILD_DIR"
sha256sum "${PACKAGE_NAME}.tar.gz" > "${PACKAGE_NAME}.tar.gz.sha256"
cd -

print_message "Package built successfully!" "$GREEN"
print_message "Package location: ${BUILD_DIR}/${PACKAGE_NAME}.tar.gz" "$GREEN"
print_message "Package size: $(du -h ${BUILD_DIR}/${PACKAGE_NAME}.tar.gz | cut -f1)" "$YELLOW"