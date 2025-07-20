#!/bin/bash

# Claude Code UI Password Reset Script
set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="claudecodeui"
DATABASE_PATH="/opt/${APP_NAME}/server/database/auth.db"

# Function to print colored output
print_message() {
    echo -e "${2}${1}${NC}"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   print_message "This script must be run as root" "$RED"
   exit 1
fi

# Check if database exists
if [ ! -f "$DATABASE_PATH" ]; then
    print_message "Database not found at $DATABASE_PATH" "$RED"
    print_message "The service may not be installed or hasn't been started yet." "$YELLOW"
    exit 1
fi

print_message "Claude Code UI Password Reset Tool" "$GREEN"
print_message "===================================" "$GREEN"

# Check if any users exist
USER_COUNT=$(sqlite3 "$DATABASE_PATH" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")

if [ "$USER_COUNT" -eq "0" ]; then
    print_message "No users found in the database." "$YELLOW"
    print_message "Please start the service and create an initial user through the web interface." "$YELLOW"
    exit 0
fi

# List existing users
print_message "\nExisting users:" "$YELLOW"
sqlite3 "$DATABASE_PATH" "SELECT id, username, created_at FROM users;"

# Ask for username
echo
read -p "Enter username to reset password: " USERNAME

# Check if user exists
USER_EXISTS=$(sqlite3 "$DATABASE_PATH" "SELECT COUNT(*) FROM users WHERE username='$USERNAME';" 2>/dev/null || echo "0")

if [ "$USER_EXISTS" -eq "0" ]; then
    print_message "User '$USERNAME' not found." "$RED"
    exit 1
fi

# Ask for new password
echo
while true; do
    read -s -p "Enter new password (minimum 6 characters): " PASSWORD
    echo
    
    if [ ${#PASSWORD} -lt 6 ]; then
        print_message "Password must be at least 6 characters long." "$RED"
        continue
    fi
    
    read -s -p "Confirm new password: " PASSWORD_CONFIRM
    echo
    
    if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
        print_message "Passwords do not match. Please try again." "$RED"
        continue
    fi
    
    break
done

# Generate bcrypt hash
print_message "\nGenerating password hash..." "$YELLOW"

# Create a temporary Node.js script to generate the hash
TEMP_SCRIPT=$(mktemp /tmp/hash-password-XXXXXX.js)
cat > "$TEMP_SCRIPT" << 'EOF'
const bcrypt = require('bcrypt');
const password = process.argv[2];
bcrypt.hash(password, 12).then(hash => {
    console.log(hash);
}).catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
EOF

# Check if bcrypt is available
if ! cd /opt/claudecodeui && node -e "require('bcrypt')" 2>/dev/null; then
    print_message "Installing bcrypt module..." "$YELLOW"
    cd /opt/claudecodeui && npm install bcrypt --no-save
fi

# Generate the hash
HASH=$(cd /opt/claudecodeui && node "$TEMP_SCRIPT" "$PASSWORD" 2>/dev/null)
rm -f "$TEMP_SCRIPT"

if [ -z "$HASH" ]; then
    print_message "Failed to generate password hash." "$RED"
    exit 1
fi

# Update the password
print_message "Updating password..." "$YELLOW"
sqlite3 "$DATABASE_PATH" "UPDATE users SET password_hash='$HASH' WHERE username='$USERNAME';"

# Restart the service
print_message "Restarting service..." "$YELLOW"
systemctl restart claudecodeui

print_message "\nPassword reset successful!" "$GREEN"
print_message "You can now login with username '$USERNAME' and your new password." "$GREEN"
print_message "Access the application at: http://localhost:3002" "$YELLOW"