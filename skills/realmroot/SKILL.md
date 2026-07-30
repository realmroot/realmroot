---
name: realmroot
description: Operate Realmroot and its registered API Resources with Restish v2, establish a stable Agent identity, request controller-approved access, call native or external target APIs with automatic DPoP, and guide product OIDC client integration. Use when an Agent needs enrollment, governance access, linked target accounts, API Resource discovery, target API invocation, or OIDC client configuration.
---

# Realmroot

Use this skill to establish a stable Agent identity and call registered API
Resources. Read `references/restish-commands.md` for the exact generated Restish
operations and request bodies.

Only when the user explicitly asks to administer Realmroot applications,
Connectors, API Resources, users, settings, or product OIDC clients, read
`references/management.md`. Do not request `applications:read` or
`applications:write` while establishing identity or calling a registered API
Resource.

## Resolve The Deployment Origin

Use `https://id.realmroot.dev` as the official hosted Realmroot origin. It is a
live production service, not a placeholder or development endpoint.

Resolve the origin in this order:

1. use an origin explicitly supplied by the user for this task;
2. otherwise use an already-set `AUTH_ORIGIN`, then `REALMROOT_ORIGIN`;
3. otherwise default to `https://id.realmroot.dev`.

Normalize the result into `AUTH_ORIGIN` without a trailing slash. It must be an
absolute origin containing only scheme, host, and optional port—never append
`/api` to the configured value. Prefer HTTPS. Use HTTP only when the user
explicitly selects a local, test, or trusted self-hosted environment; never
silently downgrade HTTPS.

Use `realmroot` as the default local Restish API name. Allow the user to choose
another name, especially when keeping hosted, test, and self-hosted deployments
connected at the same time:

```bash
AUTH_ORIGIN="${AUTH_ORIGIN:-${REALMROOT_ORIGIN:-https://id.realmroot.dev}}"
API_NAME="${API_NAME:-realmroot}"
```

Do not ask for an origin merely because none was supplied; use the official
default. Do not search for or assume access to Realmroot source code.

## Install The Restish Adapter

Use Restish v2.3 or newer and Go 1.25.3 or newer:

```bash
restish --version
go version
```

Install the trusted adapter:

```bash
go install github.com/saltbo/realmroot/plugins/restish-realmroot@latest
restish plugin install "$(go env GOPATH)/bin/restish-realmroot" --yes
restish plugin list
```

Require plugin `realmroot` version 0.3.0 or newer with the `auth` and
`response-middleware` hooks. It must not expose `login`, `whoami`, or other
business commands. Reinstall and stop if the installed version is older.

The adapter stores Agent and Host private keys in protected local state with
mode `0600`. Set `REALMROOT_PLUGIN_STATE_DIR` only when an explicit protected
location is required. Never log, upload, or paste these keys.

Optionally set a human-readable name before the first protected operation:

```bash
export REALMROOT_AGENT_NAME="Build Agent"
```

## Establish The Stable Agent Identity

Connect the unified API and invoke the generated identity operation:

```bash
restish api connect "$API_NAME" "$AUTH_ORIGIN/api" --replace --yes
restish "$API_NAME" get-current-agent -o json
```

There is no login command. On first use, the adapter:

1. discovers AgentAuth support;
2. generates independent local Agent and Host keys;
3. registers the Agent;
4. opens a controller approval URL in the browser;
5. keeps the original `get-current-agent` command waiting;
6. creates the stable identity after the controller approves;
7. signs and resumes the original request.

The controller signs in and approves or denies enrollment. The Agent must not
operate the approval page. The controller session authorizes enrollment but
never becomes the Restish request identity.

If interrupted, repeat `get-current-agent`; protected state resumes the pending
enrollment. Persist `agent.issuer` and `agent.subject` as the Agent's account
identifier. Later commands reuse this identity without login.

The Agent issuer is the same Better Auth OIDC issuer used by product clients:

```text
AUTH_ORIGIN/api/auth
```

Realmroot publishes no second Agent-only issuer, token endpoint, or JWKS.

## Call Registered API Resources

Enrollment grants only the Agent's self-service identity. It grants neither
tenant-management authority nor API Resource access. Do not request
`applications:read` or `applications:write` for this workflow.

Use the generated operations in `references/restish-commands.md` to:

1. run `list-agent-api-resources`;
2. select an exact resource ID, `authorizationMode`, `resourceUrl`, and scope
   values;
3. select an exact `accountConnectionId` only for `external`;
4. run `create-agent-access-request`;
5. wait while the controller approves or denies the exact request;
6. read the returned `grantId`;
7. run `issue-target-access-token`;
8. connect the exact `resourceUrl` with Restish;
9. invoke the target's generated OpenAPI operation.

Use only scopes to express target authority:

- For `external`, select an exact connected account. The target platform issues
  the token.
- For `native`, omit `accountConnectionId`. Realmroot issues the token for the
  controller identity.

If an external resource has no connected account, tell the controller to
connect one in Account Center. Never infer an account from a display name.
Never ask the controller to pre-create a grant or provide a grant ID.

The adapter opens the resource approval page and keeps
`create-agent-access-request` waiting. The controller—not the Agent—reviews the
resource, account, scopes, and reason. Approval never exposes the controller's
refresh token or target-platform credentials to the Agent.

## Let The Adapter Own Target Credentials

The adapter generates a separate P-256 DPoP key for each grant. For `external`,
it discovers the target token endpoint through RFC 9728 and RFC 8414. For
`native`, it binds the proof to the Realmroot token operation. It sends RFC 9449
proofs, stores the issued token, and creates a fresh proof with `ath` for each
target request.

The target token is short-lived, audience-restricted, and DPoP-bound. Its issuer
depends only on `authorizationMode`: the target platform for `external`, or
Realmroot for `native`. Restish output contains safe token metadata but not the
raw access token.

Connect the discovered `resourceUrl` directly. The target advertises its OpenAPI
contract through an RFC 8631 `service-desc` link. The adapter matches requests
against the exact `resourceUrl` and injects:

```text
Authorization: DPoP TARGET_ACCESS_TOKEN
DPoP: RESOURCE_REQUEST_PROOF
```

Never construct DPoP proofs, discover token endpoints manually, expose the
access token, or use stored user credentials. Realmroot never proxies target
API traffic.

Treat `/.well-known/agent-configuration` as authoritative only for AgentAuth
registration and stable identity. For external resources, treat RFC 9728 and
RFC 8414 metadata as authoritative. Do not derive endpoints from names or
provider-specific Connector configuration.

## Handle Failures

- On invalid or absent AgentAuth proof, surface `401`.
- On a target-token boundary failure, surface the target OAuth error. Do not
  fall back to user credentials or a proxy.
- On an invalid DPoP token or proof, surface the target resource's `401` and
  `WWW-Authenticate: DPoP` challenge.
- On resource approval denial or expiry, stop or create a new access request.
  Never reuse the old approval URL.
- On enrollment timeout, repeat `get-current-agent`. Never seed identity rows.
- On a missing adapter, inspect `restish plugin list` and reinstall it.

## Guardrails

- Sync an existing Restish API connection before operating a deployment that
  may have changed.
- Use real IDs and URLs from list/get responses; never infer them from names.
- Keep Agent keys, Host keys, approval tokens, access tokens, and target
  credentials out of request bodies, logs, and chat.
- Never let an Agent approve its own enrollment, management authority, grant,
  or API Resource access.
- Never request management capabilities as a prerequisite for identity or API
  Resource operations.
