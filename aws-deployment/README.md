# AWS Spot Instance Deployment

This directory contains all the necessary files to deploy claudecodeui on AWS Spot Instances with automatic persistence and recovery.

## Prerequisites

1. **AWS Account**: You need an AWS account with appropriate permissions
2. **AWS CLI**: Install and configure AWS CLI with your credentials
3. **Terraform**: Install Terraform (v1.0 or later)
4. **Docker**: Install Docker and Docker Compose
5. **SSH Key Pair**: Create an EC2 key pair in your target region

## Quick Start

1. **Configure Terraform Variables**:
   ```bash
   cd terraform
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your settings
   ```

2. **Deploy Infrastructure**:
   ```bash
   cd ../scripts
   ./deploy.sh
   ```

3. **Access the Application**:
   - The deployment script will output the instance IP
   - Access via `http://<instance-ip>:3008`
   - Or configure a domain name for HTTPS access

## Configuration

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `key_pair_name` | EC2 SSH key pair name | `my-key-pair` |
| `session_secret` | Secret for session encryption | `<random-string>` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `aws_region` | AWS region | `us-east-1` |
| `instance_types` | List of Spot instance types | `["t3.medium", "t3.large"]` |
| `spot_price` | Maximum Spot price | `0.05` |
| `domain_name` | Custom domain for HTTPS | `""` |
| `github_client_id` | GitHub OAuth client ID | `""` |
| `github_client_secret` | GitHub OAuth secret | `""` |

## Architecture

### Components

1. **Spot Fleet**: Manages Spot instances with automatic replacement
2. **EBS Volume**: Persistent storage for Claude data
3. **S3 Bucket**: Backup storage with versioning
4. **CloudWatch**: Logging and monitoring
5. **VPC**: Isolated network environment

### Data Persistence

- Claude data is stored on a separate EBS volume
- Hourly backups to S3
- Automatic restore on new instance launch
- Spot interruption handling with data backup

## Scripts

### deploy.sh
Main deployment script that:
- Checks prerequisites
- Builds Docker image
- Deploys infrastructure with Terraform
- Waits for instance to be ready

### backup.sh
Backup script that:
- Creates compressed archive of Claude data
- Uploads to S3 with timestamp
- Maintains backup retention policy
- Updates backup inventory

### restore.sh
Restore script that:
- Lists available backups
- Downloads and extracts selected backup
- Restores data with safety checks
- Restarts services

### userdata.sh
Instance initialization script that:
- Installs dependencies
- Mounts EBS volume
- Restores from latest backup
- Starts application
- Sets up monitoring

## Monitoring

### CloudWatch Logs
- Application logs: `/aws/ec2/claudecodeui`
- Instance logs: Check EC2 console

### Metrics
- Spot instance interruptions
- Backup success/failure
- Application health checks

## Backup and Recovery

### Manual Backup
```bash
ssh ubuntu@<instance-ip>
./backup.sh
```

### Manual Restore
```bash
ssh ubuntu@<instance-ip>
./restore.sh list  # List available backups
./restore.sh        # Restore latest
./restore.sh <backup-name>  # Restore specific
```

### Automatic Backups
- Hourly via cron job
- Before Spot interruption
- Retention: 7 days (configurable)

## Cost Optimization

1. **Instance Types**: Use multiple types for better availability
2. **Spot Price**: Set reasonable maximum (check Spot pricing history)
3. **EBS**: Use GP3 volumes for better price/performance
4. **S3**: Enable lifecycle policies for old backups

## Security

1. **Network**: 
   - Security groups restrict access
   - SSH limited to specified IPs
   
2. **Data**:
   - EBS encryption enabled
   - S3 server-side encryption
   - SSL/TLS for web traffic

3. **Access**:
   - IAM roles for EC2 instances
   - No hardcoded credentials
   - GitHub OAuth for user authentication

## Troubleshooting

### Instance Not Starting
1. Check CloudWatch logs
2. Verify Spot Fleet status in EC2 console
3. Check if Spot capacity is available

### Application Not Accessible
1. Verify security group rules
2. Check instance public IP
3. Review application logs

### Backup Failures
1. Check S3 bucket permissions
2. Verify EBS volume is attached
3. Check available disk space

### Restore Issues
1. Verify backup exists in S3
2. Check file permissions
3. Ensure services are stopped during restore

## Maintenance

### Update Application
```bash
ssh ubuntu@<instance-ip>
cd ~/claudecodeui
git pull
docker-compose build
docker-compose up -d
```

### Update Infrastructure
```bash
cd terraform
terraform plan
terraform apply
```

### Clean Up Resources
```bash
cd terraform
terraform destroy
```

## Support

For issues specific to:
- AWS deployment: Check this README and AWS documentation
- claudecodeui: See main project README
- Terraform: Consult Terraform documentation

## License

Same as the main claudecodeui project.