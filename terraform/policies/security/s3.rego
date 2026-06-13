package main

import rego.v1

pab_fields := [
	"block_public_acls",
	"block_public_policy",
	"ignore_public_acls",
	"restrict_public_buckets",
]

# Every public access block must block everything.
deny contains msg if {
	some rc in input.resource_changes
	rc.type == "aws_s3_bucket_public_access_block"
	active_resource(rc)
	some field in pab_fields
	rc.change.after[field] != true
	msg := sprintf("%s: %s must be true", [rc.address, field])
}

# Every bucket created must have a matching public access block in the plan.
deny contains msg if {
	some rc in input.resource_changes
	rc.type == "aws_s3_bucket"
	some action in rc.change.actions
	action == "create"
	not bucket_has_pab(rc.name)
	msg := sprintf("%s: bucket has no aws_s3_bucket_public_access_block", [rc.address])
}

bucket_has_pab(name) if {
	some rc in input.resource_changes
	rc.type == "aws_s3_bucket_public_access_block"
	rc.name == name
}
