#!/bin/bash
set -e

# Configuration
BACKUP_BUCKET="${BACKUP_BUCKET:-claudecodeui-backups}"
CLAUDE_DATA_DIR="${CLAUDE_DATA_DIR:-/mnt/claude-data/.claude}"
RESTORE_POINT="${1:-latest}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} INFO: $1"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} ERROR: $1"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} WARNING: $1"
}

log_prompt() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} PROMPT: $1"
}

# Show usage
usage() {
    echo "Usage: $0 [backup-name|latest|list]"
    echo "  backup-name: Specific backup file name (e.g., claude-backup-20240115-120000.tar.gz)"
    echo "  latest: Restore from the latest backup (default)"
    echo "  list: List available backups"
    exit 1
}

# List available backups
list_backups() {
    log_info "Available backups in s3://$BACKUP_BUCKET/"
    echo
    aws s3 ls "s3://$BACKUP_BUCKET/" | grep "claude-backup" | sort -r | while read -r line; do
        FILE_SIZE=$(echo "$line" | awk '{print $3}')
        FILE_DATE=$(echo "$line" | awk '{print $1, $2}')
        FILE_NAME=$(echo "$line" | awk '{print $4}')
        FILE_SIZE_MB=$((FILE_SIZE / 1024 / 1024))
        echo "  $FILE_NAME (${FILE_SIZE_MB}MB) - $FILE_DATE"
    done
    echo
    exit 0
}

# Handle arguments
if [ "$1" == "list" ]; then
    list_backups
elif [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    usage
fi

# Determine backup file to restore
if [ "$RESTORE_POINT" == "latest" ]; then
    BACKUP_FILE="latest-backup.tar.gz"
    log_info "Restoring from latest backup..."
else
    BACKUP_FILE="$RESTORE_POINT"
    log_info "Restoring from specific backup: $BACKUP_FILE"
fi

# Check if backup exists
if ! aws s3 ls "s3://$BACKUP_BUCKET/$BACKUP_FILE" > /dev/null 2>&1; then
    log_error "Backup not found: $BACKUP_FILE"
    echo
    echo "Run '$0 list' to see available backups"
    exit 1
fi

# Create temporary directory
TEMP_DIR="/tmp/restore-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$TEMP_DIR"

# Download backup
log_info "Downloading backup from S3..."
aws s3 cp "s3://$BACKUP_BUCKET/$BACKUP_FILE" "$TEMP_DIR/" || {
    log_error "Failed to download backup"
    rm -rf "$TEMP_DIR"
    exit 1
}

# Extract backup
log_info "Extracting backup archive..."
cd "$TEMP_DIR"
tar -xzf "$BACKUP_FILE" || {
    log_error "Failed to extract backup"
    rm -rf "$TEMP_DIR"
    exit 1
}

# Find the backup directory
BACKUP_DIR=$(find . -name "claude-backup-*" -type d | head -1)
if [ -z "$BACKUP_DIR" ]; then
    log_error "Backup directory not found in archive"
    rm -rf "$TEMP_DIR"
    exit 1
fi

# Display backup metadata if available
if [ -f "$BACKUP_DIR/backup-metadata.json" ]; then
    log_info "Backup metadata:"
    cat "$BACKUP_DIR/backup-metadata.json" | jq . 2>/dev/null || cat "$BACKUP_DIR/backup-metadata.json"
    echo
fi

# Check if target directory exists and has data
if [ -d "$CLAUDE_DATA_DIR" ] && [ "$(ls -A $CLAUDE_DATA_DIR 2>/dev/null)" ]; then
    log_warning "Target directory exists and contains data: $CLAUDE_DATA_DIR"
    log_prompt "Do you want to:"
    echo "  1) Backup existing data before restore (recommended)"
    echo "  2) Overwrite existing data"
    echo "  3) Cancel restore"
    read -p "Enter your choice (1-3): " choice
    
    case $choice in
        1)
            log_info "Creating backup of existing data..."
            EXISTING_BACKUP="/tmp/existing-claude-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
            tar -czf "$EXISTING_BACKUP" -C "$(dirname $CLAUDE_DATA_DIR)" "$(basename $CLAUDE_DATA_DIR)"
            log_info "Existing data backed up to: $EXISTING_BACKUP"
            ;;
        2)
            log_warning "Proceeding with overwrite..."
            ;;
        3)
            log_info "Restore cancelled"
            rm -rf "$TEMP_DIR"
            exit 0
            ;;
        *)
            log_error "Invalid choice"
            rm -rf "$TEMP_DIR"
            exit 1
            ;;
    esac
fi

# Create parent directory if it doesn't exist
PARENT_DIR=$(dirname "$CLAUDE_DATA_DIR")
if [ ! -d "$PARENT_DIR" ]; then
    log_info "Creating parent directory: $PARENT_DIR"
    mkdir -p "$PARENT_DIR"
fi

# Stop services if running
if command -v docker-compose &> /dev/null; then
    log_info "Stopping Claude Code UI services..."
    cd /home/ubuntu/claudecodeui 2>/dev/null && docker-compose down || true
fi

# Perform restore
log_info "Restoring data to $CLAUDE_DATA_DIR..."
rm -rf "$CLAUDE_DATA_DIR"
cp -r "$TEMP_DIR/$BACKUP_DIR/.claude" "$CLAUDE_DATA_DIR" || {
    log_error "Failed to restore data"
    rm -rf "$TEMP_DIR"
    exit 1
}

# Set correct permissions
log_info "Setting permissions..."
chown -R ubuntu:ubuntu "$CLAUDE_DATA_DIR"

# Restart services if they were running
if command -v docker-compose &> /dev/null && [ -f /home/ubuntu/claudecodeui/docker-compose.yml ]; then
    log_info "Starting Claude Code UI services..."
    cd /home/ubuntu/claudecodeui && docker-compose up -d
fi

# Cleanup
rm -rf "$TEMP_DIR"

# Verify restore
if [ -d "$CLAUDE_DATA_DIR" ]; then
    PROJECT_COUNT=$(find "$CLAUDE_DATA_DIR/projects" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
    log_info "Restore completed successfully!"
    log_info "Restored $PROJECT_COUNT projects"
    
    # Send CloudWatch metric (optional)
    aws cloudwatch put-metric-data \
        --metric-name RestoreSuccess \
        --namespace "ClaudeCodeUI" \
        --value 1 \
        --timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        2>/dev/null || true
else
    log_error "Restore verification failed"
    exit 1
fi

log_info "Restore process completed!"
exit 0