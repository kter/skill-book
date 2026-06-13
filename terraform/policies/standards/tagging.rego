package main

import rego.v1

taggable_types := {
	"aws_s3_bucket",
	"aws_lambda_function",
	"aws_iam_role",
	"aws_cognito_user_pool",
	"aws_apigatewayv2_api",
	"aws_cloudwatch_log_group",
	"aws_cloudfront_distribution",
	"aws_dsql_cluster",
	"aws_ssm_parameter",
}

valid_environments := {"dev", "prd", "default"}

# tags_all is only checkable when known at plan time (default_tags make it static here).
deny contains msg if {
	some rc in input.resource_changes
	taggable_types[rc.type]
	active_resource(rc)
	tags := rc.change.after.tags_all
	tags.ManagedBy != "terraform"
	msg := sprintf("%s: must be tagged ManagedBy=terraform", [rc.address])
}

deny contains msg if {
	some rc in input.resource_changes
	taggable_types[rc.type]
	active_resource(rc)
	tags := rc.change.after.tags_all
	not valid_environments[tags.Environment]
	msg := sprintf("%s: Environment tag must be one of %v", [rc.address, valid_environments])
}
