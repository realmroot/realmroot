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

## API Resource Access

Enrollment grants no API resource access. Both API authorization modes use the
same Agent operations:

1. `list-agent-api-resources` to discover authorization modes, API resources,
   supported permissions, connected accounts where applicable, and grants;
2. `create-agent-access-request` with one exact API resource, permission set,
   reason, and an account connection only for `external` mode;
3. `get-agent-access-request` or `list-agent-access-grants` to read the
   resulting grant;
4. `issue-target-access-token` with the grant ID and a DPoP proof.

The adapter opens the hosted resource approval page when a new request is
pending and keeps `create-agent-access-request` waiting. Approval creates the
access grant; a controller never pre-creates a grant or passes a grant ID to the
Agent.

For `external` mode, the controller first connects a target-platform account in
Account Center and approves that exact account and permissions. Approval never
gives the Agent the user's refresh token or target-platform credentials.

For `native` mode, omit the account connection. The product uses FlareAuth as
its OIDC provider and OAuth authorization server, and its API validates the
FlareAuth issuer, JWKS, audience, permissions, and DPoP binding.

The Agent generates and retains its own DPoP key. For `external`, discover the
target token endpoint through RFC 9728 and RFC 8414 and bind the issuance proof
to that endpoint. For `native`, bind the issuance proof to the
`issue-target-access-token` request URL. Use the same key for the resource
request proof and include `ath` for the issued access token.

The returned token is short-lived, audience-restricted, and DPoP-bound. Its
issuer is selected only by `authorizationMode`: the target platform for
`external`, or FlareAuth for `native`. Send it directly to the target API:

```text
Authorization: DPoP TARGET_ACCESS_TOKEN
DPoP: RESOURCE_REQUEST_PROOF
```

FlareAuth never proxies target API traffic. The target resource server validates
the selected issuer, audience, expiry, permissions, and DPoP binding.

Treat `/.well-known/agent-configuration` as authoritative only for AgentAuth
registration and stable identity. For `external`, treat RFC 9728 and RFC 8414
metadata as authoritative. Do not derive endpoints from names or provider-specific
Connector configuration.

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
