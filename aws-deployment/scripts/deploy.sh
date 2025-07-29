#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

print_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check for required commands
    for cmd in aws terraform docker docker-compose; do
        if ! command -v $cmd &> /dev/null; then
            print_error "$cmd is not installed. Please install it first."
            exit 1
        fi
    done
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured. Please run 'aws configure' first."
        exit 1
    fi
    
    print_status "All prerequisites met!"
}

# Build Docker image
build_docker_image() {
    print_status "Building Docker image..."
    
    cd ../..
    docker build -t claudecodeui:latest .
    
    if [ $? -eq 0 ]; then
        print_status "Docker image built successfully!"
    else
        print_error "Failed to build Docker image"
        exit 1
    fi
    
    cd aws-deployment/scripts
}

# Deploy infrastructure with Terraform
deploy_infrastructure() {
    print_status "Deploying AWS infrastructure..."
    
    cd ../terraform
    
    # Initialize Terraform
    terraform init
    
    # Create terraform.tfvars if it doesn't exist
    if [ ! -f terraform.tfvars ]; then
        print_warning "terraform.tfvars not found. Creating template..."
        cat > terraform.tfvars.example <<EOF
# AWS Configuration
aws_region = "us-east-1"
key_pair_name = "your-key-pair-name"

# Application Configuration
session_secret = "$(openssl rand -hex 32)"
github_client_id = ""
github_client_secret = ""
github_allowed_users = ""

# Optional: Domain Configuration
domain_name = ""

# Optional: Custom S3 bucket name
# backup_bucket_name = "claudecodeui-backups"
EOF
        print_error "Please edit terraform.tfvars.example and rename to terraform.tfvars"
        exit 1
    fi
    
    # Plan deployment
    print_status "Planning Terraform deployment..."
    terraform plan
    
    # Ask for confirmation
    echo
    read -p "Do you want to apply this plan? (yes/no): " -n 3 -r
    echo
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        print_warning "Deployment cancelled."
        exit 0
    fi
    
    # Apply Terraform
    terraform apply -auto-approve
    
    if [ $? -eq 0 ]; then
        print_status "Infrastructure deployed successfully!"
        
        # Save outputs
        terraform output -json > ../outputs.json
        
        # Display important information
        echo
        print_status "Deployment Summary:"
        echo "==================="
        echo "Spot Fleet ID: $(terraform output -raw spot_fleet_id)"
        echo "Backup Bucket: $(terraform output -raw backup_bucket_name)"
        echo "CloudWatch Logs: $(terraform output -raw cloudwatch_log_group)"
        echo
        echo "To get instance IPs, run:"
        echo "aws ec2 describe-spot-fleet-instances --spot-fleet-request-id $(terraform output -raw spot_fleet_id)"
        echo
    else
        print_error "Failed to deploy infrastructure"
        exit 1
    fi
    
    cd ../scripts
}

# Upload Docker image to ECR (optional)
push_to_ecr() {
    print_status "Pushing Docker image to ECR..."
    
    # This is optional and requires ECR repository to be created
    # Uncomment and modify if using ECR
    
    # REGION=$(cat ../outputs.json | jq -r '.aws_region.value')
    # ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    # ECR_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/claudecodeui"
    
    # aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_URI
    # docker tag claudecodeui:latest $ECR_URI:latest
    # docker push $ECR_URI:latest
    
    print_warning "ECR push skipped (not configured)"
}

# Wait for instance to be ready
wait_for_instance() {
    print_status "Waiting for instance to be ready..."
    
    SPOT_FLEET_ID=$(cat ../outputs.json | jq -r '.spot_fleet_id.value')
    
    # Wait for instance to be running
    for i in {1..60}; do
        INSTANCES=$(aws ec2 describe-spot-fleet-instances --spot-fleet-request-id $SPOT_FLEET_ID --query 'ActiveInstances[?InstanceHealth==`healthy`]' --output json)
        
        if [ "$(echo $INSTANCES | jq '. | length')" -gt 0 ]; then
            INSTANCE_ID=$(echo $INSTANCES | jq -r '.[0].InstanceId')
            INSTANCE_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
            
            print_status "Instance is ready!"
            echo "Instance ID: $INSTANCE_ID"
            echo "Public IP: $INSTANCE_IP"
            
            # Wait for application to start
            print_status "Waiting for application to start..."
            for j in {1..30}; do
                if curl -s -f http://$INSTANCE_IP:3008/api/health > /dev/null 2>&1; then
                    print_status "Application is running!"
                    echo
                    echo "Access the application at:"
                    echo "  http://$INSTANCE_IP:3008"
                    if [ ! -z "$(cat ../outputs.json | jq -r '.domain_name.value // empty')" ]; then
                        echo "  https://$(cat ../outputs.json | jq -r '.domain_name.value')"
                    fi
                    return 0
                fi
                sleep 10
            done
            
            print_warning "Application health check failed. Check CloudWatch logs."
            return 1
        fi
        
        sleep 10
    done
    
    print_error "Timeout waiting for instance to be ready"
    return 1
}

# Main deployment flow
main() {
    print_status "Starting Claude Code UI deployment to AWS Spot Instances"
    echo "======================================================="
    echo
    
    check_prerequisites
    build_docker_image
    deploy_infrastructure
    push_to_ecr
    wait_for_instance
    
    echo
    print_status "Deployment complete!"
    echo
    echo "Next steps:"
    echo "1. SSH into the instance to check logs: ssh ubuntu@<instance-ip>"
    echo "2. Monitor CloudWatch logs for any issues"
    echo "3. Set up your domain DNS if using a custom domain"
    echo "4. Configure GitHub OAuth if enabled"
    echo
}

# Run main function
main