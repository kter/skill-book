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

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
