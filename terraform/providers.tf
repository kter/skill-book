# Workspace-aware provider configuration
# Uses AWS profile matching the workspace name (dev/prd)
provider "aws" {
  region  = var.aws_region
  profile = terraform.workspace

  default_tags {
    tags = {
      Project     = "skill-book"
      Environment = terraform.workspace
      ManagedBy   = "terraform"
    }
  }
}

# Provider for ACM certificates (must be in us-east-1 for CloudFront)
provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = terraform.workspace

  default_tags {
    tags = {
      Project     = "skill-book"
      Environment = terraform.workspace
      ManagedBy   = "terraform"
    }
  }
}
