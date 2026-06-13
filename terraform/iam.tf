# IAM role for the API Lambda — least privilege: DSQL connect, scoped S3, logs.

resource "aws_iam_role" "api" {
  name = "${var.project_name}-api-role-${terraform.workspace}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = ["lambda.amazonaws.com"]
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-api-role-${terraform.workspace}"
  }
}

resource "aws_iam_role_policy" "dsql_access" {
  name = "dsql-access"
  role = aws_iam_role.api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dsql:DbConnect",
          "dsql:DbConnectAdmin"
        ]
        Resource = [
          aws_dsql_cluster.main.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "artifacts_access" {
  name = "artifacts-access"
  role = aws_iam_role.api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          "${aws_s3_bucket.artifacts.arn}/staging/*",
          "${aws_s3_bucket.artifacts.arn}/artifacts/*"
        ]
      }
    ]
  })
}

# Bedrock: invoke the Sonnet inference profile to summarize artifact content at publish time.
# A geographic inference profile may route to any region within its geography, so least-privilege
# requires BOTH the inference-profile ARN (in this region) AND the foundation-model ARN with a
# wildcard region. The foundation-model id is the profile id minus its geographic prefix.
locals {
  bedrock_foundation_model_id = replace(var.bedrock_model_id, "/^[a-z0-9-]+\\./", "")
}

resource "aws_iam_role_policy" "bedrock_access" {
  name = "bedrock-access"
  role = aws_iam_role.api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = [
          "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.bedrock_model_id}",
          "arn:aws:bedrock:*::foundation-model/${local.bedrock_foundation_model_id}"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
