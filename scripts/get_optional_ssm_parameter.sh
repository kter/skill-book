#!/usr/bin/env bash

set -euo pipefail

parameter_name="${1:?parameter name is required}"
aws_region="${2:?aws region is required}"
aws_profile="${3:?aws profile is required}"

if response="$(
  aws ssm get-parameter \
    --name "$parameter_name" \
    --with-decryption \
    --region "$aws_region" \
    --profile "$aws_profile" \
    --query 'Parameter.Value' \
    --output text 2>&1
)"; then
  printf '%s\n' "$response"
  exit 0
fi

if printf '%s' "$response" | grep -q "ParameterNotFound"; then
  exit 0
fi

printf '%s\n' "$response" >&2
exit 1
