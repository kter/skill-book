#!/usr/bin/env bash
# Idempotently create the Terraform remote state bucket and DynamoDB lock table.
# Usage: ./scripts/bootstrap_tf_state.sh <env> [region]

set -euo pipefail

env="${1:?env is required (dev/prd)}"
region="${2:-ap-northeast-1}"
profile="$env"

account_id="$(aws sts get-caller-identity --profile "$profile" --query Account --output text)"
bucket="skill-book-terraform-state-${account_id}"
table="skill-book-terraform-locks"

echo "Bootstrapping Terraform state for env=$env (account=$account_id, region=$region)"

if aws s3api head-bucket --bucket "$bucket" --profile "$profile" 2>/dev/null; then
  echo "State bucket already exists: $bucket"
else
  aws s3api create-bucket \
    --bucket "$bucket" \
    --region "$region" \
    --create-bucket-configuration LocationConstraint="$region" \
    --profile "$profile"
  echo "Created state bucket: $bucket"
fi

aws s3api put-bucket-versioning \
  --bucket "$bucket" \
  --versioning-configuration Status=Enabled \
  --profile "$profile"

aws s3api put-bucket-encryption \
  --bucket "$bucket" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}' \
  --profile "$profile"

aws s3api put-public-access-block \
  --bucket "$bucket" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
  --profile "$profile"

if aws dynamodb describe-table --table-name "$table" --profile "$profile" --region "$region" >/dev/null 2>&1; then
  echo "Lock table already exists: $table"
else
  aws dynamodb create-table \
    --table-name "$table" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "$region" \
    --profile "$profile"
  aws dynamodb wait table-exists --table-name "$table" --profile "$profile" --region "$region"
  echo "Created lock table: $table"
fi

echo ""
echo "Backend config for terraform/backends/${env}.hcl:"
echo "  bucket         = \"$bucket\""
echo "  key            = \"skill-book/terraform.tfstate\""
echo "  region         = \"$region\""
echo "  encrypt        = true"
echo "  dynamodb_table = \"$table\""
