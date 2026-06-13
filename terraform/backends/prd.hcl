# prd lives in the company AWS account. Defined for completeness; NOT applied
# from personal machines. Replace the account id before first use.
bucket         = "skill-book-terraform-state-REPLACE_WITH_COMPANY_ACCOUNT_ID"
key            = "skill-book/terraform.tfstate"
region         = "ap-northeast-1"
encrypt        = true
dynamodb_table = "skill-book-terraform-locks"
