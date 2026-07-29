# Restish Command Reference

FlareAuth publishes one OpenAPI 3.1 contract:

```text
API base: AUTH_ORIGIN/api
contract: AUTH_ORIGIN/api/openapi.json
```

The contract contains `get-current-agent` and every permission-gated resource operation.
There is no separate Management API command surface.

## Connect

These instructions require Restish v2 and the FlareAuth authentication adapter
from `agent-identity.md`.

```bash
AUTH_ORIGIN=https://auth.example.com
API_NAME=auth-example-com
restish --version
restish api connect "$API_NAME" "$AUTH_ORIGIN/api" --replace --yes
restish "$API_NAME" get-current-agent -o json
```

The first `get-current-agent` may wait for controller approval. It is both the
authentication trigger and the original API operation; do not run a separate
login command.

Refresh an existing connection after a server upgrade:

```bash
restish api sync API_NAME
```

## Generated Operations

Use commands generated from OpenAPI `operationId` values:

```bash
restish API_NAME --help
restish API_NAME get-current-agent -o json
restish API_NAME list-applications -o json
restish API_NAME get-application app_123 -o json
```

For JSON bodies:

```bash
restish API_NAME create-application --rsh-validate -o json < application.json
```

Generic verbs remain available for diagnostics:

```bash
restish get API_NAME/management/applications
```

Use `restish doctor api API_NAME` for discovery problems and
`restish api auth inspect API_NAME --redact` for shareable auth diagnostics.

## Permission Model

Every CLI request remains the Agent principal. Default enrollment permits
the current Agent and Agent-owned resources. Tenant administration requires an active
AgentAuth capability:

- reads: `management:read`;
- writes: `management:write`.

A `403` names the missing capability. Request it through the unified OpenAPI:

```bash
restish API_NAME request-agent-management-access --rsh-validate -o json <<'JSON'
{
  "capabilities": ["management:read", "management:write"],
  "reason": "Operate this FlareAuth tenant"
}
JSON
```

The FlareAuth Restish adapter automatically opens the returned
`approval.verification_uri_complete` in the controller's browser. The controller
uses the same hosted Agent approval page used by other AgentAuth capabilities.
The request command waits and returns only after the grants are active; denial
exits with an error. Repeating a pending or expired request opens a fresh
approval link and invalidates the old one.

After approval, repeat the original protected operation. The adapter deliberately
does not replay it because that operation may mutate state. Never authenticate
Restish as the controller.

Destructive governance operations still require reading and confirming the
exact target before execution.

## External API Resource Access

Discover the exact API resource, linked target-platform account, permissions,
and any existing grants:

```bash
restish API_NAME list-agent-api-resources -o json
restish API_NAME list-agent-access-grants -o json
```

Use IDs and permission values from the discovery response. Create one exact
access request:

```bash
restish API_NAME create-agent-access-request --rsh-validate -o json <<'JSON'
{
  "target": {
    "type": "api-resource",
    "apiResourceId": "resource_123",
    "accountConnectionId": "connection_123"
  },
  "permissions": ["projects:read"],
  "reason": "List projects for the controller"
}
JSON
```

When approval is required, the adapter opens the hosted controller page and
keeps this command waiting. An approved response contains `grantId`. A denial
or expiry exits with an error; do not reuse that approval URL.

Generate a DPoP key locally and keep it for both token issuance and the target
request. Discover the target token endpoint through RFC 9728 protected-resource
metadata followed by RFC 8414 authorization-server metadata. Create a DPoP proof
with:

```text
typ: dpop+jwt
alg: an algorithm advertised by the target authorization server
jwk: the public DPoP key
htm: POST
htu: the discovered target token endpoint
jti: a fresh random identifier
iat: the current time
```

Issue the target-platform token:

```bash
restish API_NAME issue-target-access-token grant_123 \
  --rsh-validate -o json <<JSON
{
  "dpopProof": "$DPOP_PROOF"
}
JSON
```

The result contains `accessToken`, `tokenType`, `expiresIn`, `permissions`, and
`apiResource`. It is not a FlareAuth session token. Call the target API directly
with `Authorization: DPoP ACCESS_TOKEN` and a fresh DPoP proof for the target
method and URL. Include `ath` over the access token and reuse the same DPoP key.

If no account connection appears in `list-agent-api-resources`, tell the
controller to connect that target account in Account Center. The Agent cannot
create or approve the user's account connection.
