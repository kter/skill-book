# Cognito
output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "cognito_web_client_id" {
  description = "Cognito web app client ID"
  value       = aws_cognito_user_pool_client.web.id
}

output "cognito_cli_client_id" {
  description = "Cognito CLI app client ID"
  value       = aws_cognito_user_pool_client.cli.id
}

output "cognito_domain" {
  description = "Cognito hosted UI domain URL"
  value       = local.cognito_domain_url
}

# DSQL
output "dsql_identifier" {
  description = "Aurora DSQL cluster identifier"
  value       = aws_dsql_cluster.main.identifier
}

output "dsql_endpoint" {
  description = "Aurora DSQL cluster endpoint hostname"
  value       = "${aws_dsql_cluster.main.identifier}.dsql.${var.aws_region}.on.aws"
}

# API
output "api_url" {
  description = "API URL (custom domain)"
  value       = "https://${local.current_env.api_domain_name}"
}

output "integration_test_bypass_token" {
  description = "Integration test bypass token (dev only)"
  value       = local.enable_integration_bypass ? random_password.integration_test_bypass_token[0].result : ""
  sensitive   = true
}

output "integration_test_bypass_token_2" {
  description = "Second integration test bypass token (dev only)"
  value       = local.enable_integration_bypass ? random_password.integration_test_bypass_token_2[0].result : ""
  sensitive   = true
}

# Frontend
output "frontend_bucket_name" {
  description = "Frontend S3 bucket name"
  value       = aws_s3_bucket.frontend.id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.main.id
}

output "website_url" {
  description = "Website URL"
  value       = "https://${local.current_env.domain_name}"
}

# Storage
output "artifacts_bucket_name" {
  description = "Artifacts S3 bucket name"
  value       = aws_s3_bucket.artifacts.bucket
}

output "environment" {
  description = "Current environment"
  value       = terraform.workspace
}
