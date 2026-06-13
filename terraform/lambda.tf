# API Lambda (Hono, Node.js zip bundle) and API Gateway HTTP API

locals {
  # Integration-test bypass tokens are dev-only. Terraform generates them,
  # stores them in SSM SecureString, and injects them into the Lambda
  # environment. Never hardcoded in source.
  enable_integration_bypass = terraform.workspace == "dev"

  integration_bypass_env = local.enable_integration_bypass ? {
    INTEGRATION_TEST_BYPASS_TOKEN   = random_password.integration_test_bypass_token[0].result
    INTEGRATION_TEST_BYPASS_TOKEN_2 = random_password.integration_test_bypass_token_2[0].result
  } : {}

  api_lambda_environment = merge(
    local.integration_bypass_env,
    {
      ENVIRONMENT           = terraform.workspace
      DSQL_CLUSTER_ENDPOINT = aws_dsql_cluster.main.identifier
      ARTIFACTS_BUCKET      = aws_s3_bucket.artifacts.bucket
      COGNITO_USER_POOL_ID  = aws_cognito_user_pool.main.id
      COGNITO_WEB_CLIENT_ID = aws_cognito_user_pool_client.web.id
      COGNITO_CLI_CLIENT_ID = aws_cognito_user_pool_client.cli.id
      COGNITO_DOMAIN        = local.cognito_domain_url
      CORS_ORIGINS = join(",", concat(
        ["https://${local.current_env.domain_name}"],
        terraform.workspace == "dev" ? ["http://localhost:3000"] : []
      ))
      BEDROCK_ENABLED  = "true"
      BEDROCK_REGION   = var.aws_region
      BEDROCK_MODEL_ID = var.bedrock_model_id
    }
  )
}

resource "random_password" "integration_test_bypass_token" {
  count   = local.enable_integration_bypass ? 1 : 0
  length  = 48
  special = false
}

resource "random_password" "integration_test_bypass_token_2" {
  count   = local.enable_integration_bypass ? 1 : 0
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "integration_test_bypass_token" {
  count = local.enable_integration_bypass ? 1 : 0
  name  = "/${var.project_name}/${terraform.workspace}/integration-test-bypass-token"
  type  = "SecureString"
  value = random_password.integration_test_bypass_token[0].result

  tags = {
    Name = "${var.project_name}-integration-bypass-token-${terraform.workspace}"
  }
}

resource "aws_ssm_parameter" "integration_test_bypass_token_2" {
  count = local.enable_integration_bypass ? 1 : 0
  name  = "/${var.project_name}/${terraform.workspace}/integration-test-bypass-token-2"
  type  = "SecureString"
  value = random_password.integration_test_bypass_token_2[0].result

  tags = {
    Name = "${var.project_name}-integration-bypass-token-2-${terraform.workspace}"
  }
}

# Lambda function (zip bundle produced by `make build-api`)
resource "aws_lambda_function" "api" {
  function_name    = "${var.project_name}-api-${terraform.workspace}"
  role             = aws_iam_role.api.arn
  filename         = "${path.module}/../apps/api/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../apps/api/dist/lambda.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 512
  architectures    = ["arm64"]

  environment {
    variables = local.api_lambda_environment
  }

  tags = {
    Name = "${var.project_name}-api-${terraform.workspace}"
  }
}

resource "aws_cloudwatch_log_group" "api_lambda" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = 90

  tags = {
    Name = "${var.project_name}-api-logs-${terraform.workspace}"
  }
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/api-gateway/${aws_apigatewayv2_api.api.name}"
  retention_in_days = 90

  tags = {
    Name = "${var.project_name}-api-gateway-logs-${terraform.workspace}"
  }
}

# API Gateway HTTP API
resource "aws_apigatewayv2_api" "api" {
  name          = "${var.project_name}-api-${terraform.workspace}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = concat(
      ["https://${local.current_env.domain_name}"],
      terraform.workspace == "dev" ? ["http://localhost:3000"] : []
    )
    allow_methods     = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allow_headers     = ["Authorization", "Content-Type", "X-Dev-User"]
    allow_credentials = true
    max_age           = 86400
  }

  tags = {
    Name = "${var.project_name}-api-${terraform.workspace}"
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId               = "$context.requestId"
      ip                      = "$context.identity.sourceIp"
      requestTime             = "$context.requestTime"
      httpMethod              = "$context.httpMethod"
      routeKey                = "$context.routeKey"
      status                  = "$context.status"
      protocol                = "$context.protocol"
      integrationLatency      = "$context.integrationLatency"
      integrationErrorMessage = "$context.integrationErrorMessage"
    })
  }

  tags = {
    Name = "${var.project_name}-api-${terraform.workspace}"
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*"
}

# ACM certificate for the API custom domain (regional)
resource "aws_acm_certificate" "api" {
  domain_name       = local.current_env.api_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.main.zone_id
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for record in aws_route53_record.api_cert_validation : record.fqdn]
}

resource "aws_apigatewayv2_domain_name" "api" {
  domain_name = local.current_env.api_domain_name

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.api.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "api" {
  api_id      = aws_apigatewayv2_api.api.id
  domain_name = aws_apigatewayv2_domain_name.api.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = local.current_env.api_domain_name
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
