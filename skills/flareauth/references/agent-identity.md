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
restish API_NAME whoami -o json
```

There is deliberately no login command. On first use, the auth adapter:

1. discovers AgentAuth support;
2. generates independent local Agent and Host keys;
3. registers the Agent;
4. opens one controller approval URL in the browser;
5. keeps the original `whoami` process waiting;
6. creates the stable identity after approval;
7. signs and resumes that original `whoami` request.

The controller signs in to the hosted page and approves once. The controller's
session authorizes enrollment but never becomes the Restish request identity.
If the process is interrupted, repeat `whoami`; protected state resumes the
pending enrollment.

Persist `identity.issuer` and `identity.subject` as the Agent's account
identifier. Later commands use the same Agent identity and require no login.

## Authority

Enrollment grants no tenant management or external-account access. For
FlareAuth administration, the Agent requests one or both coarse AgentAuth
capabilities:

```text
management:read
management:write
```

Use the unified OpenAPI `request-agent-capabilities` operation. The request is
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

## Failure Boundaries

- `401`: AgentAuth proof is absent or invalid, or the local binding is inactive.
- `403` with `management:read` or `management:write`: the Agent needs that
  AgentAuth capability.
- Capability denial: explain the denial and stop; do not retry the protected
  operation automatically.
- Capability approval timeout: invoke `request-agent-capabilities` again and use
  the newly opened approval page.
- Enrollment timeout: invoke `whoami` again; do not seed identity rows.
- Missing adapter: inspect `restish plugin list` and reinstall the repository
  binary.
