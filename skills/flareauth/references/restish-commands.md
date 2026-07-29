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
restish get API_NAME/applications
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
