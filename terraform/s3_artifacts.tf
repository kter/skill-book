# S3 bucket holding artifact content: staging/ (short-lived client uploads)
# and artifacts/ (canonical published zips, written only by the API Lambda).

resource "aws_s3_bucket" "artifacts" {
  bucket = "${var.project_name}-artifacts-${terraform.workspace}-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${var.project_name}-artifacts-${terraform.workspace}"
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Staged uploads expire after a day; the publish flow deletes them eagerly anyway.
resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-staging"
    status = "Enabled"

    filter {
      prefix = "staging/"
    }

    expiration {
      days = 1
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Browser uploads PUT staged zips via presigned URLs; downloads GET presigned zips.
resource "aws_s3_bucket_cors_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = concat(
      ["https://${local.current_env.domain_name}"],
      terraform.workspace == "dev" ? ["http://localhost:3000"] : []
    )
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}
