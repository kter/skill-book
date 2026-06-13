# Cognito pre-sign-up trigger Lambda — enforces the email-domain whitelist at
# registration time, covering both native sign-up and Google federation. The
# bundle is produced alongside the API by `make build-api` (esbuild).

resource "aws_iam_role" "presignup" {
  name = "${var.project_name}-presignup-role-${terraform.workspace}"

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
    Name = "${var.project_name}-presignup-role-${terraform.workspace}"
  }
}

resource "aws_iam_role_policy_attachment" "presignup_basic" {
  role       = aws_iam_role.presignup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "presignup" {
  function_name    = "${var.project_name}-presignup-${terraform.workspace}"
  role             = aws_iam_role.presignup.arn
  filename         = "${path.module}/../apps/api/dist/presignup.zip"
  source_code_hash = filebase64sha256("${path.module}/../apps/api/dist/presignup.zip")
  handler          = "presignup.handler"
  runtime          = "nodejs22.x"
  timeout          = 5
  memory_size      = 128
  architectures    = ["arm64"]

  tags = {
    Name = "${var.project_name}-presignup-${terraform.workspace}"
  }
}

resource "aws_cloudwatch_log_group" "presignup_lambda" {
  name              = "/aws/lambda/${aws_lambda_function.presignup.function_name}"
  retention_in_days = 90

  tags = {
    Name = "${var.project_name}-presignup-logs-${terraform.workspace}"
  }
}

resource "aws_lambda_permission" "cognito_presignup" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.presignup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}
