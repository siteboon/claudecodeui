#!/bin/bash
set -e

# Configuration
BACKUP_BUCKET="${BACKUP_BUCKET:-claudecodeui-backups}"
CLAUDE_DATA_DIR="${CLAUDE_DATA_DIR:-/mnt/claude-data/.claude}"
BACKUP_PREFIX="claude-backup"
RETENTION_DAYS=7

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
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

# Check if Claude data directory exists
if [ ! -d "$CLAUDE_DATA_DIR" ]; then
    log_error "Claude data directory not found: $CLAUDE_DATA_DIR"
    exit 1
fi

# Create temporary backup directory
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="${BACKUP_PREFIX}-${TIMESTAMP}"
TEMP_DIR="/tmp/${BACKUP_NAME}"

log_info "Starting backup process..."
log_info "Source: $CLAUDE_DATA_DIR"
log_info "Destination: s3://$BACKUP_BUCKET/"

# Create temporary directory
mkdir -p "$TEMP_DIR"

# Copy Claude data
log_info "Copying Claude data..."
cp -r "$CLAUDE_DATA_DIR" "$TEMP_DIR/" || {
    log_error "Failed to copy Claude data"
    rm -rf "$TEMP_DIR"
    exit 1
}

# Get size of backup
BACKUP_SIZE=$(du -sh "$TEMP_DIR" | cut -f1)
log_info "Backup size: $BACKUP_SIZE"

# Create metadata file
cat > "$TEMP_DIR/backup-metadata.json" <<EOF
{
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "hostname": "$(hostname)",
    "instance_id": "$(ec2-metadata --instance-id 2>/dev/null | cut -d' ' -f2 || echo 'unknown')",
    "backup_size": "$BACKUP_SIZE",
    "source_directory": "$CLAUDE_DATA_DIR"
}
EOF

# Create tarball
log_info "Creating backup archive..."
cd /tmp
tar -czf "${BACKUP_NAME}.tar.gz" "$BACKUP_NAME" || {
    log_error "Failed to create backup archive"
    rm -rf "$TEMP_DIR" "${BACKUP_NAME}.tar.gz"
    exit 1
}

# Upload to S3
log_info "Uploading to S3..."
aws s3 cp "${BACKUP_NAME}.tar.gz" "s3://$BACKUP_BUCKET/" || {
    log_error "Failed to upload to S3"
    rm -rf "$TEMP_DIR" "${BACKUP_NAME}.tar.gz"
    exit 1
}

# Also save as latest for easy restore
aws s3 cp "${BACKUP_NAME}.tar.gz" "s3://$BACKUP_BUCKET/latest-backup.tar.gz" || {
    log_warning "Failed to update latest-backup.tar.gz"
}

# Create backup inventory
log_info "Updating backup inventory..."
aws s3 ls "s3://$BACKUP_BUCKET/" --recursive | grep "${BACKUP_PREFIX}" | awk '{print $4}' > /tmp/backup-inventory.txt
aws s3 cp /tmp/backup-inventory.txt "s3://$BACKUP_BUCKET/backup-inventory.txt"

# Cleanup old backups
log_info "Cleaning up old backups (older than $RETENTION_DAYS days)..."
CUTOFF_DATE=$(date -d "$RETENTION_DAYS days ago" +%Y%m%d)

aws s3 ls "s3://$BACKUP_BUCKET/" | grep "${BACKUP_PREFIX}" | while read -r line; do
    BACKUP_FILE=$(echo "$line" | awk '{print $4}')
    BACKUP_DATE=$(echo "$BACKUP_FILE" | grep -oP '\d{8}' | head -1)
    
    if [ ! -z "$BACKUP_DATE" ] && [ "$BACKUP_DATE" -lt "$CUTOFF_DATE" ]; then
        log_info "Deleting old backup: $BACKUP_FILE"
        aws s3 rm "s3://$BACKUP_BUCKET/$BACKUP_FILE"
    fi
done

# Cleanup temporary files
rm -rf "$TEMP_DIR" "${BACKUP_NAME}.tar.gz" /tmp/backup-inventory.txt

# Calculate and display statistics
TOTAL_BACKUPS=$(aws s3 ls "s3://$BACKUP_BUCKET/" | grep "${BACKUP_PREFIX}" | wc -l)
BUCKET_SIZE=$(aws s3 ls "s3://$BACKUP_BUCKET/" --recursive --summarize | grep "Total Size" | awk '{print $3}')
BUCKET_SIZE_MB=$((BUCKET_SIZE / 1024 / 1024))

log_info "Backup completed successfully!"
log_info "Backup name: ${BACKUP_NAME}.tar.gz"
log_info "Total backups: $TOTAL_BACKUPS"
log_info "Total bucket size: ${BUCKET_SIZE_MB} MB"

# Send CloudWatch metric (optional)
aws cloudwatch put-metric-data \
    --metric-name BackupSuccess \
    --namespace "ClaudeCodeUI" \
    --value 1 \
    --timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    2>/dev/null || true

exit 0