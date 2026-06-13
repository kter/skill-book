package main

import rego.v1

# Inline role policies must not grant Action "*" or Resource "*".

deny contains msg if {
	some rc in input.resource_changes
	rc.type == "aws_iam_role_policy"
	active_resource(rc)
	policy := json.unmarshal(rc.change.after.policy)
	some statement in policy.Statement
	statement.Effect == "Allow"
	some action in as_array(statement.Action)
	action == "*"
	msg := sprintf("%s: IAM policy must not allow Action \"*\"", [rc.address])
}

deny contains msg if {
	some rc in input.resource_changes
	rc.type == "aws_iam_role_policy"
	active_resource(rc)
	policy := json.unmarshal(rc.change.after.policy)
	some statement in policy.Statement
	statement.Effect == "Allow"
	some resource in as_array(statement.Resource)
	resource == "*"
	msg := sprintf("%s: IAM policy must not allow Resource \"*\"", [rc.address])
}

# Lambda execution roles may only be assumed by AWS service principals we expect.
allowed_trust_services := {"lambda.amazonaws.com", "edgelambda.amazonaws.com"}

deny contains msg if {
	some rc in input.resource_changes
	rc.type == "aws_iam_role"
	active_resource(rc)
	policy := json.unmarshal(rc.change.after.assume_role_policy)
	some statement in policy.Statement
	some service in as_array(statement.Principal.Service)
	not allowed_trust_services[service]
	msg := sprintf("%s: unexpected trust principal %s", [rc.address, service])
}
