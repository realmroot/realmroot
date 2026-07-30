# Realmroot Tenant Management

Read this reference only when the user explicitly asks to administer a
Realmroot tenant or configure a product OIDC client. Do not load or execute this
workflow while an Agent is merely establishing identity, discovering registered
API Resources, requesting resource scopes, or invoking a target API.

## Contents

- [Management boundary](#management-boundary)
- [Request management authority](#request-management-authority)
- [Operate management resources](#operate-management-resources)
- [Configure OIDC clients](#configure-oidc-clients)
- [Use device authorization](#use-device-authorization)
- [Management guardrails](#management-guardrails)

## Management Boundary

Every Realmroot resource CLI request remains the Agent's stable `(issuer, subject)`
principal. Authority is controller-approved per resource. Use
`{resource}:read` for reads and `{resource}:write` for mutations; read-only
resources expose only `:read`. Request only what the explicit administration
task requires. These capabilities are not target API scopes and are never
prerequisites for:

- `list-agent-api-resources`;
- `create-agent-access-request`;
- `get-agent-access-request`;
- `list-agent-access-grants`;
- `issue-target-access-token`;
- direct target API invocation.

## Request Management Authority

Use the origin resolved by `../SKILL.md`; do not independently replace it with
the hosted default. Connect the unified Realmroot API and establish the Agent
identity first:

```bash
restish api connect "$API_NAME" "$AUTH_ORIGIN/api" --replace --yes
restish "$API_NAME" get-current-agent -o json
```

Request the minimum required capability with the generated operation:

```bash
restish "$API_NAME" request-agent-capabilities --rsh-validate -o json <<'JSON'
{
  "capabilities": ["applications:read", "applications:write"],
  "reason": "Administer the Realmroot tenant"
}
JSON
```

The adapter opens `approval.verification_uri_complete` in the controller's
browser and keeps the request waiting. The controller—not the Agent—reviews and
approves or denies the capabilities. Never operate the approval page as the
Agent or authenticate Restish as the controller.

Approval returns active grants. Denial exits with an error. Repeating a pending
or expired request creates a fresh approval link and invalidates the old one.
After approval, rerun the original management operation; the adapter never
replays it because it may mutate state.

## Operate Management Resources

Use operations generated from OpenAPI `operationId` values:

```bash
restish "$API_NAME" --help
restish "$API_NAME" list-applications -o json
restish "$API_NAME" get-application app_123 -o json
restish "$API_NAME" create-application --rsh-validate -o json < application.json
```

Use generic verbs only for diagnostics:

```bash
restish get "$API_NAME/applications"
```

Use `restish doctor api "$API_NAME"` for discovery failures and
`restish api auth inspect "$API_NAME" --redact` for shareable authentication
diagnostics.

Read current state before a mutation. Use real IDs from list/get responses,
apply the smallest requested change, and read the resource back afterward.
Confirm exact targets before destructive operations.

## Configure OIDC Clients

Use the Realmroot issuer:

```text
AUTH_ORIGIN/api/auth
```

Prefer discovery metadata:

```text
AUTH_ORIGIN/api/auth/.well-known/openid-configuration
```

Use `openid profile email` for common product clients. Add `offline_access`
only when refresh tokens are required. Management capabilities are not product
OAuth scopes and must not be added to ordinary clients.

Choose the client type by runtime:

| Client type | Use for | Secret | Typical grants |
| --- | --- | --- | --- |
| `public_spa` | Browser apps | No | `authorization_code`, `refresh_token` |
| `public_native` | Mobile, desktop, CLI, runner, daemon apps | No | `authorization_code`, `refresh_token`, device-code grant |
| `confidential_web` | Server-side apps that can hold secrets | Yes | `authorization_code`, `refresh_token`, optional `client_credentials` |

Use PKCE for authorization-code clients where supported. Set
`tokenEndpointAuthMethod: none` for public clients. Store a confidential
client's returned `clientSecret` immediately; it is shown only once.

Distinguish `AUTH_ORIGIN`, where Realmroot runs, from `APP_ORIGIN`, where the
consuming product runs. Create a public SPA client:

```bash
restish "$API_NAME" create-application --rsh-validate -o json <<'JSON'
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

Create a public native authorization-code client:

```bash
restish "$API_NAME" create-application --rsh-validate -o json <<'JSON'
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

Create a public native device-login client:

```bash
restish "$API_NAME" create-application --rsh-validate -o json <<'JSON'
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

Create a confidential web client:

```bash
restish "$API_NAME" create-application --rsh-validate -o json <<'JSON'
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

Add `client_credentials` only when a confidential backend must act without a
user.

## Use Device Authorization

Use device authorization only with `public_native` clients. Consume discovery
metadata instead of hard-coding endpoints:

```text
device_authorization_endpoint: AUTH_ORIGIN/api/auth/device/code
token_endpoint: AUTH_ORIGIN/api/auth/oauth2/token
grant_type: urn:ietf:params:oauth:grant-type:device_code
```

Follow RFC 8628:

1. Request a device code with `client_id` and product scopes.
2. Show `user_code` and `verification_uri`.
3. Let the user open `/device`, sign in, and approve or deny.
4. Poll the token endpoint with the device-code grant.
5. Handle `authorization_pending`, `slow_down`, `access_denied`, and
   `expired_token`.
6. Consume the OAuth/OIDC response. `openid` yields an `id_token`;
   `offline_access` yields a `refresh_token`.

Prefer the product's OIDC library device-flow support.

## Management Guardrails

- Never request management capabilities unless the user explicitly asks for a
  tenant-management operation.
- Before a management mutation, state the resolved `AUTH_ORIGIN`. If it resolved
  to the default production origin `https://realmroot.dev` rather than an
  origin explicitly supplied for the task, obtain confirmation before mutating
  the tenant.
- Never let the Agent approve its own enrollment or management request.
- Treat asset uploads as `multipart/form-data` with one `file` field.
- Treat raw secrets as create/rotation-only output; never expect list/detail
  operations to reveal them.
- Never log or expose Agent keys, Host keys, client secrets, approval tokens, or
  access tokens.
