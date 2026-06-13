package main

import rego.v1

# Buckets and Lambda functions must carry the project prefix.

deny contains msg if {
	some rc in input.resource_changes
	rc.type == "aws_s3_bucket"
	active_resource(rc)
	not startswith(rc.change.after.bucket, "skill-book-")
	msg := sprintf("%s: bucket name must start with skill-book-", [rc.address])
}

deny contains msg if {
	some rc in input.resource_changes
	rc.type == "aws_lambda_function"
	active_resource(rc)
	not startswith(rc.change.after.function_name, "skill-book-")
	msg := sprintf("%s: function name must start with skill-book-", [rc.address])
}
