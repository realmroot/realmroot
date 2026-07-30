# Restish Command Reference

Realmroot publishes one OpenAPI 3.1 contract:

```text
API base: AUTH_ORIGIN/api
contract: AUTH_ORIGIN/api/openapi.json
```

The contract contains `get-current-agent` and every scope-gated resource
operation. This reference covers only the Agent's self-service API Resource
workflow. For explicit tenant-administration work, read `management.md`.

## Contents

- [Connect](#connect)
- [Generated operations](#generated-operations)
- [API Resource access](#api-resource-access)

## Connect

These instructions require Restish v2 and the Realmroot authentication adapter
installed as described in `../SKILL.md`.

```bash
AUTH_ORIGIN="${AUTH_ORIGIN:-${REALMROOT_ORIGIN:-https://id.realmroot.dev}}"
API_NAME="${API_NAME:-realmroot}"
restish --version
restish api connect "$API_NAME" "$AUTH_ORIGIN/api" --replace --yes
restish "$API_NAME" get-current-agent -o json
```

The first `get-current-agent` may wait for controller approval. It is both the
authentication trigger and the original API operation; do not run a separate
login command.

Refresh an existing connection after a server upgrade:

```bash
restish api sync "$API_NAME"
```

Add another isolated Restish profile without creating another API name:

```bash
PROFILE_NAME=staging
PROFILE_ORIGIN=https://auth.example.com
restish api set "$API_NAME" \
  "profiles.${PROFILE_NAME}.base_url: ${PROFILE_ORIGIN}/api"
restish api inspect "$API_NAME"
restish -p "$PROFILE_NAME" "$API_NAME" get-current-agent -o json
```

The new profile has its own credential configuration. Do not copy or inherit it
from `default`; invoke the profile's first protected operation explicitly. The
adapter establishes or reuses stable Agent state according to runtime and
issuer, never according to profile name.

## Generated Operations

Use commands generated from OpenAPI `operationId` values:

```bash
restish "$API_NAME" --help
restish "$API_NAME" get-current-agent -o json
```

Use `restish doctor api "$API_NAME"` for discovery problems and
`restish api auth inspect "$API_NAME" --redact` for shareable auth diagnostics.

## API Resource Access

The Agent's own identity is sufficient for this workflow. Do not request
`applications:read` or `applications:write`.

Discover the exact API resource, authorization mode, protected resource URL,
requestable scopes, linked accounts where applicable, and any grants:

```bash
restish "$API_NAME" list-agent-api-resources -o json
restish "$API_NAME" list-agent-access-grants -o json
```

Use the exact resource ID, `resourceUrl`, scope values, and connection ID from
the discovery response. Do not infer a resource URL from its name, construct a
target path, or invent scope values.

For an `external` resource, include the exact connected target account:

```bash
restish "$API_NAME" create-agent-access-request --rsh-validate -o json <<'JSON'
{
  "target": {
    "type": "api-resource",
    "apiResourceId": "resource_123",
    "accountConnectionId": "connection_123"
  },
  "scopes": ["projects:read"],
  "reason": "List projects for the controller"
}
JSON
```

For a `native` resource, omit the account connection:

```bash
restish "$API_NAME" create-agent-access-request --rsh-validate -o json <<'JSON'
{
  "target": {
    "type": "api-resource",
    "apiResourceId": "resource_123"
  },
  "scopes": ["projects:read"],
  "reason": "List projects for the controller"
}
JSON
```

When approval is required, the adapter opens the hosted controller page and
keeps this command waiting. An approved response contains `grantId`. A denial
or expiry exits with an error; do not reuse that approval URL. Never ask the
controller to pre-create a grant.

If the command is interrupted after creating the request, use the returned
request ID to resume inspection:

```bash
restish "$API_NAME" get-agent-access-request request_123 -o json
```

Issue the target-platform token:

```bash
restish "$API_NAME" issue-target-access-token grant_123 -o json
```

The adapter creates a separate grant-specific DPoP key, performs RFC 9728 and
RFC 8414 discovery when the mode is `external`, sends the RFC 9449 proof header,
and stores the returned token. Restish output contains safe token metadata,
including `resourceUrl`, but not the raw access token.

Connect the target resource directly. Its resource URL must advertise an
OpenAPI contract with an RFC 8631 `service-desc` Link header:

```bash
TARGET_API=projects
RESOURCE_URL=https://api.example.com
restish api connect "$TARGET_API" "$RESOURCE_URL" --replace --yes
restish "$TARGET_API" --help
restish "$TARGET_API" list-projects -o json
```

Use the actual generated operation shown by `--help`. The plugin matches the
request against the registered `resourceUrl`, injects `Authorization: DPoP ...`
and a fresh proof, and refreshes reusable grants when needed. Do not use curl,
manually discover token endpoints, expose the access token, or construct DPoP
JWTs.

If an `external` resource has no account connection, tell the controller to
connect that target account at `$AUTH_ORIGIN/connections`. An empty account
connection list is expected for `native`.
