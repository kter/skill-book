package main

import rego.v1

# Normalize an IAM statement field that may be a string or an array.
as_array(value) := [value] if is_string(value)

as_array(value) := value if is_array(value)

# Resources being created or updated in this plan.
active_resource(rc) if {
	some action in rc.change.actions
	action != "delete"
	action != "no-op"
}
