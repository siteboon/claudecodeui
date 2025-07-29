output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = aws_subnet.public[*].id
}

output "security_group_id" {
  description = "ID of the application security group"
  value       = aws_security_group.app.id
}

output "backup_bucket_name" {
  description = "Name of the S3 backup bucket"
  value       = aws_s3_bucket.backup.id
}

output "ebs_volume_id" {
  description = "ID of the EBS data volume"
  value       = aws_ebs_volume.data.id
}

output "spot_fleet_id" {
  description = "ID of the Spot Fleet request"
  value       = aws_spot_fleet_request.app.id
}

output "cloudwatch_log_group" {
  description = "Name of the CloudWatch log group"
  value       = aws_cloudwatch_log_group.app.name
}

output "iam_instance_profile_name" {
  description = "Name of the IAM instance profile"
  value       = aws_iam_instance_profile.ec2.name
}

output "connection_info" {
  description = "Information for connecting to the application"
  value = {
    note = "Use 'aws ec2 describe-spot-fleet-instances --spot-fleet-request-id ${aws_spot_fleet_request.app.id}' to get instance IPs"
    ports = {
      http  = 80
      https = 443
      api   = 3008
    }
  }
}