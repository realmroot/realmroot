---
name: flareauth
description: Operate a FlareAuth deployment with Restish v2, establish and use a stable Agent identity, and guide product OIDC client integration. Use this when an agent needs to register itself, obtain an (issuer, sub) identity through controller approval, inspect Agent governance, configure credential brokerage, inspect or change FlareAuth resources, or configure public SPA, native, confidential web, or device-authorization OIDC clients.
---

# FlareAuth

Use this skill for three related tasks:

- Establishing and using a stable Agent identity.
- Operating a FlareAuth deployment through its unified API.
- Guiding product OIDC clients that integrate with FlareAuth.

For Agent enrollment, stable identity creation, and the controller approval handoff,
read `references/agent-identity.md`. Install and use the repository's Restish
authentication adapter for AgentAuth key custody and proof signing; do not
construct proof JWTs from memory. The adapter contributes no commands.

For the unified API Restish workflow, read
`references/restish-commands.md`.

## Setup

First identify the deployment origin you are operating. Use the exact auth
origin from the user, deployment repository, Cloudflare Worker, or `/api/configz`
response. Do not guess a production domain from the product name.

On first use, an agent must establish the FlareAuth deployment origin before it
changes anything. `AUTH_ORIGIN` is the FlareAuth deployment origin, such as a
production custom domain or a `workers.dev` origin.

If the user did not provide `AUTH_ORIGIN`, inspect the deployment repository or
Cloudflare Worker configuration when available. If neither is available, ask for
the deployment origin before continuing.

For deployment operations, connect and authorize a Restish API first. The command
sequence is in `references/restish-commands.md`; use that reference rather than
reconstructing Restish commands from memory.

## Authentication

Restish command-line operations always authenticate as the Agent. The first
protected OpenAPI command—normally `get-current-agent`—triggers transparent enrollment and
waits for one controller approval. There is no `login` command and no
administrator OAuth identity in the CLI.

Enrollment grants only the Agent's self-service identity. Tenant management
operations require the AgentAuth capabilities `management:read` or
`management:write`. Request them with the generated `request-agent-management-access`
operation. FlareAuth reuses its existing Agent capability approval request and
hosted approval page. The Restish adapter opens that page in the controller's
browser automatically and keeps the capability-request command waiting. An
approval returns the active grants; a denial exits with an error. The adapter
never replays the previously denied business operation, so run that operation
again after the capability request succeeds. Every CLI request remains the
Agent's stable `(issuer, subject)` principal.

The stable Agent issuer is the same Better Auth OIDC issuer used by product
clients: `AUTH_ORIGIN/api/auth`. FlareAuth publishes no second Agent-only
issuer, token endpoint, or JWKS.

Agent authority tokens are OAuth JWT access tokens for resource servers, not
OIDC login or UserInfo tokens. Resource servers trust the shared issuer/JWKS
and validate the token audience and DPoP binding; product OIDC sessions remain
the human login surface.

For an external API resource, first run `list-agent-api-resources`. Select exact
`apiResourceId`, `accountConnectionId`, and permission values from that response.
Then use `create-agent-access-request`; never infer an account connection from a
display name. The adapter opens the controller approval page and keeps the
request waiting. After approval, use the returned `grantId` with
`issue-target-access-token`. The complete command sequence and DPoP requirements
are in `references/restish-commands.md`.

If the API was already connected, sync its OpenAPI contract before operating
it. Restish continues to use the locally held Agent and Host keys.

## OIDC Client Integration

Use the FlareAuth deployment issuer for product clients:

```text
AUTH_ORIGIN/api/auth
```

Prefer discovery metadata instead of hard-coding endpoints:

```text
AUTH_ORIGIN/api/auth/.well-known/openid-configuration
```

Common product scopes are `openid profile email`. Add `offline_access` only
when the client needs refresh tokens. Management scopes are reserved for the
system CLI client and are not accepted on ordinary product clients.

Choose the client type by where the application runs:

| Client type | Use for | Secret | Typical grants |
| --- | --- | --- | --- |
| `public_spa` | Browser apps that cannot hold secrets | No | `authorization_code`, `refresh_token` |
| `public_native` | Mobile, desktop, CLI, runner, daemon clients | No | `authorization_code`, `refresh_token`, device-code grant |
| `confidential_web` | Server-side web apps and backends that can hold secrets | Yes | `authorization_code`, `refresh_token`, `client_credentials` when needed |

All authorization-code clients should use PKCE where their OIDC library
supports it. Public clients use `tokenEndpointAuthMethod: none`; confidential
clients use a client secret.

## Creating OIDC Clients

Connect and authorize an `API_NAME` before running these examples. Distinguish
the FlareAuth deployment origin from the consuming product origin.
`AUTH_ORIGIN` is where FlareAuth runs; `APP_ORIGIN` is the product application's
origin used in OIDC redirect URIs.

Create a public SPA application:

```bash
restish API_NAME create-application \
  --rsh-validate \
  -o json <<'JSON'
{
  "name": "Customer Portal",
  "slug": "customer-portal",
  "clientType": "public_spa",
  "redirectUris": ["https://APP_ORIGIN/oidc/callback"],
  "postLogoutRedirectUris": ["https://APP_ORIGIN/signed-out"],
  "corsOrigins": ["https://APP_ORIGIN"],
  "allowedGrantTypes": ["authorization_code", "refresh_token"],
  "allowedScopes": ["openid", "profile", "email", "offline_access"],
  "firstParty": true,
  "trusted": true
}
JSON
```

Create a public native authorization-code application:

```bash
restish API_NAME create-application \
  --rsh-validate \
  -o json <<'JSON'
{
  "name": "Desktop App",
  "slug": "desktop-app",
  "clientType": "public_native",
  "redirectUris": ["com.example.desktop:/callback", "http://127.0.0.1:8484/callback"],
  "allowedGrantTypes": ["authorization_code", "refresh_token"],
  "allowedScopes": ["openid", "profile", "email", "offline_access"],
  "firstParty": true,
  "trusted": true
}
JSON
```

Create a public native device-login application:

```bash
restish API_NAME create-application \
  --rsh-validate \
  -o json <<'JSON'
{
  "name": "Runner CLI",
  "slug": "runner-cli",
  "clientType": "public_native",
  "redirectUris": ["com.example.runner:/callback"],
  "allowedGrantTypes": ["urn:ietf:params:oauth:grant-type:device_code"],
  "allowedScopes": ["openid", "profile", "email", "offline_access"],
  "firstParty": true,
  "trusted": true
}
JSON
```

Create a confidential web application:

```bash
restish API_NAME create-application \
  --rsh-validate \
  -o json <<'JSON'
{
  "name": "Admin Backend",
  "slug": "admin-backend",
  "clientType": "confidential_web",
  "redirectUris": ["https://ADMIN_ORIGIN/oidc/callback"],
  "postLogoutRedirectUris": ["https://ADMIN_ORIGIN/signed-out"],
  "allowedGrantTypes": ["authorization_code", "refresh_token"],
  "allowedScopes": ["openid", "profile", "email", "offline_access"],
  "firstParty": true,
  "trusted": true
}
JSON
```

For confidential clients, store the returned `clientSecret` immediately. It is
shown only once. Add `client_credentials` only when that backend must act
without a user.

## Device Authorization Flow

Use device authorization only with `public_native` clients.

The discovery document advertises the device authorization endpoint and
device-code grant when supported:

```text
device_authorization_endpoint: AUTH_ORIGIN/api/auth/device/code
token_endpoint: AUTH_ORIGIN/api/auth/oauth2/token
grant_type: urn:ietf:params:oauth:grant-type:device_code
```

Device flow:

1. Request a device code from `/api/auth/device/code` with `client_id` and
   scopes such as `openid profile email offline_access`.
2. Show `user_code` and `verification_uri` to the user.
3. The user opens `/device`, signs in, and approves or denies the request.
4. Poll `/api/auth/oauth2/token` with the device-code grant.
5. Handle RFC 8628 polling errors: `authorization_pending`, `slow_down`,
   `access_denied`, and `expired_token`.
6. On success, consume the OAuth/OIDC token response. `openid` returns an
   `id_token`; `offline_access` returns a `refresh_token`.

Device-code request:

```bash
curl -sS -X POST "$AUTH_ORIGIN/api/auth/device/code" \
  -H "content-type: application/json" \
  --data '{"client_id":"CLIENT_ID","scope":"openid profile email offline_access"}'
```

Token polling request:

```bash
curl -sS -X POST "$AUTH_ORIGIN/api/auth/oauth2/token" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
  --data-urlencode "client_id=CLIENT_ID" \
  --data-urlencode "device_code=DEVICE_CODE"
```

For generic OIDC client libraries, prefer discovery metadata and the library's
device authorization support.

## Guardrails

- Always sync before operating a deployment you have not used recently.
- Always confirm the deployment origin and Restish API name before making changes.
- Prefer resource nouns and real IDs from list/get responses; do not infer IDs
  from names.
- System-managed applications such as `flareauth-cli` must not be deleted or modified.
- Asset upload endpoints use `multipart/form-data` with a single `file` field.
- Raw secrets are returned only once on creation or rotation; never expect list/detail responses to reveal secret material.
- Generate Agent and Host private keys locally. Never place them in Restish request bodies, approval URLs, logs, or chat.
- An Agent may initiate login, but it must not approve its own login, grants, or external API resource access.
- For large changes, read current state first, apply the smallest patch, then read back the resource to verify.
