#!/bin/bash
set -e

# Variables passed from Terraform
PROJECT_NAME="${project_name}"
ENVIRONMENT="${environment}"
BACKUP_BUCKET="${backup_bucket}"
EBS_VOLUME_ID="${ebs_volume_id}"
GITHUB_CLIENT_ID="${github_client_id}"
GITHUB_CLIENT_SECRET="${github_client_secret}"
GITHUB_ALLOWED_USERS="${github_allowed_users}"
SESSION_SECRET="${session_secret}"
DOMAIN_NAME="${domain_name}"

# Log output
exec > >(tee -a /var/log/userdata.log)
exec 2>&1

echo "Starting userdata script at $(date)"

# Update system
apt-get update
apt-get upgrade -y

# Install required packages
apt-get install -y \
    docker.io \
    docker-compose \
    git \
    awscli \
    jq \
    htop \
    tmux \
    vim \
    curl \
    nginx \
    certbot \
    python3-certbot-nginx

# Enable Docker
systemctl enable docker
systemctl start docker

# Add ubuntu user to docker group
usermod -aG docker ubuntu

# Install CloudWatch agent
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
dpkg -i -E ./amazon-cloudwatch-agent.deb
rm amazon-cloudwatch-agent.deb

# Configure CloudWatch agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/userdata.log",
            "log_group_name": "/aws/ec2/$PROJECT_NAME",
            "log_stream_name": "{instance_id}/userdata"
          },
          {
            "file_path": "/home/ubuntu/claudecodeui/logs/app.log",
            "log_group_name": "/aws/ec2/$PROJECT_NAME",
            "log_stream_name": "{instance_id}/app"
          }
        ]
      }
    }
  }
}
EOF

# Start CloudWatch agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

# Attach and mount EBS volume
INSTANCE_ID=$(ec2-metadata --instance-id | cut -d " " -f 2)
AVAILABILITY_ZONE=$(ec2-metadata --availability-zone | cut -d " " -f 2)

# Wait for EBS volume to be available
while true; do
    VOLUME_STATE=$(aws ec2 describe-volumes --volume-ids $EBS_VOLUME_ID --query 'Volumes[0].State' --output text)
    if [ "$VOLUME_STATE" == "available" ]; then
        break
    fi
    echo "Waiting for EBS volume to be available... (current state: $VOLUME_STATE)"
    sleep 5
done

# Attach the volume
aws ec2 attach-volume --volume-id $EBS_VOLUME_ID --instance-id $INSTANCE_ID --device /dev/xvdf

# Wait for volume to attach
while [ ! -e /dev/xvdf ]; do
    echo "Waiting for volume to attach..."
    sleep 5
done

# Format volume if needed (first time only)
if ! file -s /dev/xvdf | grep -q filesystem; then
    mkfs.ext4 /dev/xvdf
fi

# Mount the volume
mkdir -p /mnt/claude-data
mount /dev/xvdf /mnt/claude-data

# Add to fstab for persistent mounting
echo "/dev/xvdf /mnt/claude-data ext4 defaults,nofail 0 2" >> /etc/fstab

# Create claude directory structure
mkdir -p /mnt/claude-data/.claude
chown -R ubuntu:ubuntu /mnt/claude-data

# Link to ubuntu home directory
ln -sf /mnt/claude-data/.claude /home/ubuntu/.claude

# Clone the repository
cd /home/ubuntu
sudo -u ubuntu git clone https://github.com/kei9o/claudecodeui.git
cd claudecodeui

# Checkout the deployment branch
sudo -u ubuntu git checkout aws-spot-deployment || sudo -u ubuntu git checkout main

# Create .env file
cat > .env <<EOF
NODE_ENV=production
PORT=3008
VITE_PORT=3009
SESSION_SECRET=$SESSION_SECRET
GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET
GITHUB_CALLBACK_URL=https://$DOMAIN_NAME/api/auth/github/callback
GITHUB_ALLOWED_USERS=$GITHUB_ALLOWED_USERS
EOF

chown ubuntu:ubuntu .env
chmod 600 .env

# Install Claude Code CLI (if not already present)
if ! command -v claude &> /dev/null; then
    # Note: Replace with actual Claude Code CLI installation commands
    echo "Claude Code CLI installation would go here"
fi

# Restore from backup if exists
if aws s3 ls s3://$BACKUP_BUCKET/latest-backup.tar.gz; then
    echo "Restoring from backup..."
    aws s3 cp s3://$BACKUP_BUCKET/latest-backup.tar.gz /tmp/
    tar -xzf /tmp/latest-backup.tar.gz -C /mnt/claude-data/
    rm /tmp/latest-backup.tar.gz
fi

# Build and start the application
cd /home/ubuntu/claudecodeui
sudo -u ubuntu docker-compose up -d

# Setup SSL with Let's Encrypt (if domain is provided)
if [ ! -z "$DOMAIN_NAME" ]; then
    # Copy nginx configuration
    cp aws-deployment/nginx/default.conf /etc/nginx/sites-available/claudecodeui
    
    # Update server_name in nginx config
    sed -i "s/server_name _;/server_name $DOMAIN_NAME;/g" /etc/nginx/sites-available/claudecodeui
    
    # Enable the site
    ln -sf /etc/nginx/sites-available/claudecodeui /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    
    # Test nginx configuration
    nginx -t
    
    # Reload nginx
    systemctl reload nginx
    
    # Get SSL certificate
    certbot --nginx -d $DOMAIN_NAME --non-interactive --agree-tos --email admin@$DOMAIN_NAME
fi

# Setup backup cron job
cat > /home/ubuntu/backup.sh <<'EOF'
#!/bin/bash
BACKUP_DIR="/tmp/claude-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p $BACKUP_DIR

# Copy Claude data
cp -r /mnt/claude-data/.claude $BACKUP_DIR/

# Create tarball
tar -czf /tmp/latest-backup.tar.gz -C $BACKUP_DIR .

# Upload to S3
aws s3 cp /tmp/latest-backup.tar.gz s3://$BACKUP_BUCKET/
aws s3 cp /tmp/latest-backup.tar.gz s3://$BACKUP_BUCKET/backup-$(date +%Y%m%d-%H%M%S).tar.gz

# Cleanup
rm -rf $BACKUP_DIR /tmp/latest-backup.tar.gz
EOF

chmod +x /home/ubuntu/backup.sh
chown ubuntu:ubuntu /home/ubuntu/backup.sh

# Add to crontab (hourly backup)
echo "0 * * * * /home/ubuntu/backup.sh >> /var/log/backup.log 2>&1" | crontab -u ubuntu -

# Setup spot instance interruption handler
cat > /home/ubuntu/spot-interrupt-handler.sh <<'EOF'
#!/bin/bash
while true; do
    if curl -s http://169.254.169.254/latest/meta-data/spot/instance-action | grep -q terminate; then
        echo "Spot instance termination notice detected!"
        # Run backup
        /home/ubuntu/backup.sh
        # Gracefully stop services
        cd /home/ubuntu/claudecodeui && docker-compose down
        # Detach EBS volume
        aws ec2 detach-volume --volume-id $EBS_VOLUME_ID
        break
    fi
    sleep 5
done
EOF

chmod +x /home/ubuntu/spot-interrupt-handler.sh
chown ubuntu:ubuntu /home/ubuntu/spot-interrupt-handler.sh

# Run spot interrupt handler in background
nohup sudo -u ubuntu /home/ubuntu/spot-interrupt-handler.sh &

# Create health check endpoint
cat > /home/ubuntu/health-check.sh <<'EOF'
#!/bin/bash
curl -f http://localhost:3008/api/health || exit 1
EOF
chmod +x /home/ubuntu/health-check.sh

echo "Userdata script completed at $(date)"

# Send notification
aws sns publish --topic-arn arn:aws:sns:$AWS_DEFAULT_REGION:$AWS_ACCOUNT_ID:$PROJECT_NAME-notifications \
    --message "Claude Code UI instance started successfully" \
    --subject "Claude Code UI Deployment" || true