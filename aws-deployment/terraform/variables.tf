variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name for resource tagging"
  type        = string
  default     = "claudecodeui"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "production"
}

variable "instance_types" {
  description = "List of instance types for Spot Fleet"
  type        = list(string)
  default     = ["t3.medium", "t3.large", "t3a.medium", "t3a.large"]
}

variable "spot_price" {
  description = "Maximum price for Spot instances"
  type        = string
  default     = "0.05"
}

variable "target_capacity" {
  description = "Target capacity for Spot Fleet"
  type        = number
  default     = 1
}

variable "key_pair_name" {
  description = "EC2 key pair name for SSH access"
  type        = string
}

variable "allowed_ssh_ips" {
  description = "List of IPs allowed to SSH"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "ebs_volume_size" {
  description = "Size of EBS volume for persistent data (GB)"
  type        = number
  default     = 20
}

variable "domain_name" {
  description = "Domain name for the application (optional)"
  type        = string
  default     = ""
}

variable "github_client_id" {
  description = "GitHub OAuth client ID"
  type        = string
  default     = ""
}

variable "github_client_secret" {
  description = "GitHub OAuth client secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "github_allowed_users" {
  description = "Comma-separated list of allowed GitHub usernames"
  type        = string
  default     = ""
}

variable "session_secret" {
  description = "Session secret for authentication"
  type        = string
  sensitive   = true
}

variable "backup_bucket_name" {
  description = "S3 bucket name for backups"
  type        = string
  default     = ""
}