# Spot Fleet Request
resource "aws_spot_fleet_request" "app" {
  iam_fleet_role                      = aws_iam_role.spot_fleet.arn
  allocation_strategy                 = "diversified"
  target_capacity                     = var.target_capacity
  valid_until                         = timeadd(timestamp(), "8760h") # 1 year
  terminate_instances_with_expiration = true
  instance_interruption_behaviour     = "terminate"
  
  # Replace unhealthy instances
  replace_unhealthy_instances = true
  
  # Spot price
  spot_price = var.spot_price

  # Launch specifications for each instance type
  dynamic "launch_specification" {
    for_each = var.instance_types
    
    content {
      instance_type          = launch_specification.value
      ami                    = data.aws_ami.ubuntu.id
      key_name               = var.key_pair_name
      vpc_security_group_ids = [aws_security_group.app.id]
      subnet_id              = aws_subnet.public[0].id
      iam_instance_profile   = aws_iam_instance_profile.ec2.name
      
      user_data = base64encode(templatefile("${path.module}/../scripts/userdata.sh", {
        project_name         = var.project_name
        environment          = var.environment
        backup_bucket        = aws_s3_bucket.backup.id
        ebs_volume_id        = aws_ebs_volume.data.id
        github_client_id     = var.github_client_id
        github_client_secret = var.github_client_secret
        github_allowed_users = var.github_allowed_users
        session_secret       = var.session_secret
        domain_name          = var.domain_name
      }))
      
      root_block_device {
        volume_type = "gp3"
        volume_size = 30
        encrypted   = true
      }
      
      tags = {
        Name        = "${var.project_name}-spot-instance"
        Environment = var.environment
        InstanceType = launch_specification.value
      }
    }
  }

  tags = {
    Name        = "${var.project_name}-spot-fleet"
    Environment = var.environment
  }
}

# IAM Role for Spot Fleet
resource "aws_iam_role" "spot_fleet" {
  name = "${var.project_name}-spot-fleet-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "spotfleet.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "${var.project_name}-spot-fleet-role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "spot_fleet" {
  role       = aws_iam_role.spot_fleet.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2SpotFleetTaggingRole"
}

# CloudWatch Log Group for application logs
resource "aws_cloudwatch_log_group" "app" {
  name              = "/aws/ec2/${var.project_name}"
  retention_in_days = 7

  tags = {
    Name        = "${var.project_name}-logs"
    Environment = var.environment
  }
}

# CloudWatch Alarm for Spot instance termination
resource "aws_cloudwatch_metric_alarm" "spot_termination" {
  alarm_name          = "${var.project_name}-spot-termination"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "SpotInstanceInterruption"
  namespace           = "AWS/EC2"
  period              = "60"
  statistic           = "Maximum"
  threshold           = "0"
  alarm_description   = "Trigger when Spot instance is about to be terminated"
  treat_missing_data  = "notBreaching"

  dimensions = {
    SpotFleetRequestId = aws_spot_fleet_request.app.id
  }

  tags = {
    Name        = "${var.project_name}-spot-termination-alarm"
    Environment = var.environment
  }
}

# EventBridge Rule for Spot Instance Interruption
resource "aws_cloudwatch_event_rule" "spot_interruption" {
  name        = "${var.project_name}-spot-interruption"
  description = "Capture Spot Instance interruption warnings"

  event_pattern = jsonencode({
    source      = ["aws.ec2"]
    detail-type = ["EC2 Spot Instance Interruption Warning"]
  })

  tags = {
    Name        = "${var.project_name}-spot-interruption-rule"
    Environment = var.environment
  }
}

# Lambda function for handling Spot interruptions
resource "aws_iam_role" "lambda_spot_handler" {
  name = "${var.project_name}-lambda-spot-handler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "${var.project_name}-lambda-spot-handler-role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_spot_handler.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_spot_handler" {
  name = "${var.project_name}-lambda-spot-handler-policy"
  role = aws_iam_role.lambda_spot_handler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ssm:SendCommand",
          "s3:PutObject"
        ]
        Resource = "*"
      }
    ]
  })
}