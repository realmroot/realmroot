# Agent Identity Workflow

Use this workflow when an Agent needs its own stable FlareAuth identity. The
identity is `(issuer, subject)`. AgentAuth keys prove control of a registered
host; they are credentials, not the identity itself.

## Install The Authentication Adapter

Build and install the trusted repository plugin:

```bash
pnpm run plugin:test
pnpm run plugin:build
restish plugin install ./plugins/restish-flareauth/restish-flareauth --yes
restish plugin list
```

Its manifest must list plugin `flareauth` with the `auth` and
`response-middleware` hooks. It must not expose `login`, `whoami`, or any other
business command.

The adapter stores Agent and Host private keys in protected local state with
mode `0600`. Set `FLAREAUTH_PLUGIN_STATE_DIR` only when the runtime needs an
explicit protected location. Never log, upload, or paste those keys.

Set a human-readable name before the first protected operation when the default
machine-derived name is unsuitable:

```bash
export FLAREAUTH_AGENT_NAME="Build Agent"
```

## Connect And Establish Identity

Connect Restish to the unified API:

```bash
restish api connect API_NAME AUTH_ORIGIN/api --replace --yes
```

Then invoke the OpenAPI-generated identity operation:

```bash
restish API_NAME get-current-agent -o json
```

There is deliberately no login command. On first use, the auth adapter:

1. discovers AgentAuth support;
2. generates independent local Agent and Host keys;
3. registers the Agent;
4. opens one controller approval URL in the browser;
5. keeps the original `get-current-agent` process waiting;
6. creates the stable identity after approval;
7. signs and resumes that original `get-current-agent` request.

The controller signs in to the hosted page and approves once. The controller's
session authorizes enrollment but never becomes the Restish request identity.
If the process is interrupted, repeat `get-current-agent`; protected state resumes the
pending enrollment.

Persist `agent.issuer` and `agent.subject` as the Agent's account identifier.
Later commands use the same Agent identity and require no login.
`agent.issuer` is the shared Better Auth issuer
`AUTH_ORIGIN/api/auth`; it is also the issuer discovered by product OIDC
clients.

## Authority

Enrollment grants no tenant management or external API resource access. For
FlareAuth administration, the Agent requests one or both coarse AgentAuth
capabilities:

```text
management:read
management:write
```

Use the unified OpenAPI `request-agent-management-access` operation. The request is
stored in the existing AgentAuth `approval_request` flow and approved from the
same hosted `/agent/approve` page, which the adapter opens automatically. The
command waits until the controller approves or denies the request. Approval
returns the active grants; denial exits with an error. Repeating an outstanding
request creates a fresh approval link and expires the old one, so a stale or
already-used browser tab cannot decide the new request.

Without that grant, protected management operations return `403` naming the
missing capability. After the capability request succeeds, rerun the previously
denied OpenAPI command. The adapter does not replay business operations. Do not
switch profiles or authenticate as the controller.

## External API Resource Access

An Agent does not receive external access during enrollment. The controller
first connects a target-platform account in Account Center. The Agent then uses
the unified OpenAPI operations:

1. `list-agent-api-resources` to discover API resources, connected accounts,
   supported permissions, and existing grants;
2. `create-agent-access-request` with one exact API resource, account
   connection, permission set, and reason;
3. `get-agent-access-request` or `list-agent-access-grants` to read the
   resulting grant;
4. `issue-target-access-token` with the grant ID and a DPoP proof.

The adapter opens the hosted resource approval page when a new request is
pending and keeps `create-agent-access-request` waiting. The controller approves
the exact target account and permissions. Approval never gives the Agent the
user's refresh token or target-platform credentials.

The Agent generates and retains its own DPoP key. Discover the target token
endpoint from the API resource's RFC 9728 protected-resource metadata and its
authorization server's RFC 8414 metadata. The proof supplied to
`issue-target-access-token` uses `typ=dpop+jwt`, the public JWK, `htm=POST`, and
`htu` equal to that discovered target token endpoint. Use the same key for the
resource request proof and include `ath` for the issued access token.

The returned token is short-lived, target-platform issued, audience-restricted,
and DPoP-bound. Send it directly to the target API:

```text
Authorization: DPoP TARGET_ACCESS_TOKEN
DPoP: RESOURCE_REQUEST_PROOF
```

FlareAuth brokers the standard OAuth exchange but does not proxy target API
traffic. The target resource server validates its own token, audience, expiry,
permissions, and DPoP binding.

Treat `/.well-known/agent-configuration` as authoritative only for AgentAuth
registration and stable identity. Treat RFC 9728 and RFC 8414 metadata as
authoritative for each target platform. Do not derive endpoints from names or
provider-specific Connector configuration.

## Failure Boundaries

- `401`: AgentAuth proof is absent or invalid, or the local binding is inactive.
- Target-token failures surface the target OAuth boundary error; do not fall
  back to stored user credentials or a proxy path.
- DPoP-protected resources return `401` with a `WWW-Authenticate: DPoP`
  challenge when the access token or proof is invalid.
- `403` with `management:read` or `management:write`: the Agent needs that
  AgentAuth capability.
- Capability denial: explain the denial and stop; do not retry the protected
  operation automatically.
- Capability approval timeout: invoke `request-agent-management-access` again and use
  the newly opened approval page.
- Resource approval denial or expiry: stop or invoke
  `create-agent-access-request` again; never reuse the old approval URL.
- Enrollment timeout: invoke `get-current-agent` again; do not seed identity rows.
- Missing adapter: inspect `restish plugin list` and reinstall the repository
  binary.
