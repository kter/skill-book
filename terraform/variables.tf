variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "skill-book"
}

variable "bedrock_model_id" {
  description = "Bedrock inference-profile id used to summarize artifact content at publish time"
  type        = string
  default     = "jp.anthropic.claude-sonnet-4-6"
}

# Environment-specific configurations
locals {
  env_config = {
    dev = {
      domain_name      = "skill-book.dev.devtools.site"
      api_domain_name  = "api.skill-book.dev.devtools.site"
      hosted_zone_name = "dev.devtools.site"
    }
    prd = {
      domain_name      = "skill-book.devtools.site"
      api_domain_name  = "api.skill-book.devtools.site"
      hosted_zone_name = "devtools.site"
    }
  }

  # Fall back to dev so `terraform validate` works in the default workspace
  current_env = lookup(local.env_config, terraform.workspace, local.env_config["dev"])
}

variable "cognito_callback_urls" {
  description = "Additional Cognito callback URLs (for local development)"
  type        = list(string)
  default     = ["http://localhost:3000/auth/callback/"]
}

variable "cognito_logout_urls" {
  description = "Additional Cognito logout URLs (for local development)"
  type        = list(string)
  default     = ["http://localhost:3000/"]
}

variable "enable_google_idp" {
  description = "Enable the Google identity provider. Requires SSM SecureStrings /skill-book/<env>/google-oauth-client-id and -secret (see `make put-google-oauth`)."
  type        = bool
  default     = false
}

variable "cognito_domain_suffix" {
  description = "Suffix appended to the Cognito hosted UI domain prefix in case of a region-wide name collision"
  type        = string
  default     = ""
}
