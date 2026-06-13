# Backend configuration is provided via -backend-config flag
# Usage: terraform init -backend-config=backends/dev.hcl
#    or: terraform init -backend-config=backends/prd.hcl
terraform {
  backend "s3" {}
}
