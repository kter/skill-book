# Cognito User Pool: email/password sign-in plus optional Google federation.

resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-${terraform.workspace}"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Enforce the email-domain whitelist at registration (native + federated).
  lambda_config {
    pre_sign_up = aws_lambda_function.presignup.arn
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    name                     = "name"
    attribute_data_type      = "String"
    required                 = false
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  mfa_configuration = "OFF"

  tags = {
    Name = "${var.project_name}-user-pool-${terraform.workspace}"
  }
}

# Google identity provider (optional — requires SSM parameters; see `make put-google-oauth`)
data "aws_ssm_parameter" "google_client_id" {
  count           = var.enable_google_idp ? 1 : 0
  name            = "/${var.project_name}/${terraform.workspace}/google-oauth-client-id"
  with_decryption = true
}

data "aws_ssm_parameter" "google_client_secret" {
  count           = var.enable_google_idp ? 1 : 0
  name            = "/${var.project_name}/${terraform.workspace}/google-oauth-client-secret"
  with_decryption = true
}

resource "aws_cognito_identity_provider" "google" {
  count         = var.enable_google_idp ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = data.aws_ssm_parameter.google_client_id[0].value
    client_secret    = data.aws_ssm_parameter.google_client_secret[0].value
    authorize_scopes = "email profile openid"
  }

  attribute_mapping = {
    email = "email"
    name  = "name"
  }
}

locals {
  identity_providers = concat(["COGNITO"], var.enable_google_idp ? ["Google"] : [])
}

# Web app client (public, no secret)
resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_name}-web-${terraform.workspace}"
  user_pool_id = aws_cognito_user_pool.main.id

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = local.identity_providers

  callback_urls = concat(
    var.cognito_callback_urls,
    ["https://${local.current_env.domain_name}/auth/callback/"]
  )

  logout_urls = concat(
    var.cognito_logout_urls,
    ["https://${local.current_env.domain_name}/"]
  )

  prevent_user_existence_errors = "ENABLED"
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_PASSWORD_AUTH"
  ]

  generate_secret = false

  depends_on = [aws_cognito_identity_provider.google]
}

# CLI app client (public, PKCE with loopback redirect)
resource "aws_cognito_user_pool_client" "cli" {
  name         = "${var.project_name}-cli-${terraform.workspace}"
  user_pool_id = aws_cognito_user_pool.main.id

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = local.identity_providers

  callback_urls = [
    "http://localhost:8765/callback",
    "http://127.0.0.1:8765/callback"
  ]

  logout_urls = [
    "http://localhost:8765/logout"
  ]

  prevent_user_existence_errors = "ENABLED"
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_PASSWORD_AUTH"
  ]

  generate_secret = false

  depends_on = [aws_cognito_identity_provider.google]
}

# Cognito Hosted UI domain
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.project_name}-${terraform.workspace}${var.cognito_domain_suffix}"
  user_pool_id = aws_cognito_user_pool.main.id
}

locals {
  cognito_domain_url = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}
