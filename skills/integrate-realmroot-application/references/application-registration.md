# Product OIDC Clients

Use this reference when the application integration must create or update its
Realmroot Application registration. Use `$realmroot` to establish identity
and obtain management authority before following these operations.

## Contents

- [Select the client](#select-the-client)
- [Create a browser client](#create-a-browser-client)
- [Create a native client](#create-a-native-client)
- [Create a web client](#create-a-web-client)
- [Create a machine client](#create-a-machine-client)
- [Update client resources](#update-client-resources)
- [Use device authorization](#use-device-authorization)

## Select The Client

Use issuer discovery at:

```text
AUTH_ORIGIN/api/auth/.well-known/openid-configuration
```

Request `applications:read` and `applications:write` through `$realmroot`,
then choose the client by runtime:

| Client type | Use for | Secret | Typical grants |
| --- | --- | --- | --- |
| `public_spa` | Browser apps | No | `authorization_code`, `refresh_token` |
| `public_native` | Mobile, desktop, CLI, runners | No | `authorization_code`, `refresh_token`; optional device code |
| `confidential_web` | Server-side user sign-in | Yes | `authorization_code`, `refresh_token` |
| `machine` | Backend service or Worker without a user | Yes | `client_credentials`, token exchange |

The type derives grants, OIDC scopes, PKCE, client authentication, and whether a
secret is issued. Do not send these derived fields in create or update requests.
Use separate Applications when a product needs both user sign-in and machine
access.

Public clients use PKCE and token endpoint authentication method `none`.
Confidential clients use `client_secret_basic` or `client_secret_post` as
returned by the Application representation. `firstParty` and `trusted` default
to `false`; `trusted: true` skips user consent and therefore requires explicit
user intent.

Select these authorization dimensions before creation:

- `ownerOrganizationId`: the Organization responsible for the Application;
- `resourceScopes`: optional Resource Server IDs and scopes the client may
  request, selected from current Resource Server responses and contracts;
- `oidcClaims`: deprecated compatibility input. Realmroot accepts and ignores it while all Applications migrate to the platform token profile.

Client selection is complete when its type, redirects, Resource Server scope
allowlists, consent policy, and secret-handling capability are explicit.

Treat every name, slug, owner, Resource Server, origin, and redirect in the examples
as a template. Replace it with an exact user-confirmed value before mutation.

List applications before mutation. When a discovered application overlaps the
requested slug, client identity, or redirect URIs, present it and obtain an
explicit choice to reuse, update, or create a distinct client.

## Create A Browser Client

Validate `APP_ORIGIN` as an absolute origin and remove its optional trailing
slash:

```bash
APP_ORIGIN="${APP_ORIGIN%/}"
restish post "$API_NAME/applications" --rsh-print b -o json <<JSON
{
  "name": "Customer Portal",
  "slug": "customer-portal",
  "clientType": "public_spa",
  "ownerOrganizationId": "${OWNER_ORGANIZATION_ID}",
  "redirectUris": ["${APP_ORIGIN}/oidc/callback"],
  "postLogoutRedirectUris": ["${APP_ORIGIN}/signed-out"],
  "corsOrigins": ["${APP_ORIGIN}"]
}
JSON
```

Replace names and routes with the consuming product's exact requirements.

## Create A Native Client

For authorization code:

```bash
restish post "$API_NAME/applications" --rsh-print b -o json <<'JSON'
{
  "name": "Desktop App",
  "slug": "desktop-app",
  "clientType": "public_native",
  "ownerOrganizationId": "org_123",
  "redirectUris": ["com.example.desktop:/callback", "http://127.0.0.1:8484/callback"],
  "deviceLoginEnabled": false
}
JSON
```

Set `deviceLoginEnabled` to `true` only when the Native Application must use
device authorization.

## Create A Web Client

Validate `APP_ORIGIN` as an absolute origin and remove its optional trailing
slash. Obtain an exact protected output file path from the user before creating
the client, because the response contains its one-time secret:

```bash
APP_ORIGIN="${APP_ORIGIN%/}"
CLIENT_OUTPUT_FILE=/protected/path/client.json
(
  umask 077
  set -o noclobber
  restish post "$API_NAME/applications" --rsh-print b -o json > "$CLIENT_OUTPUT_FILE" <<JSON
{
  "name": "Admin Backend",
  "slug": "admin-backend",
  "clientType": "confidential_web",
  "ownerOrganizationId": "${OWNER_ORGANIZATION_ID}",
  "redirectUris": ["${APP_ORIGIN}/oidc/callback"],
  "postLogoutRedirectUris": ["${APP_ORIGIN}/signed-out"]
}
JSON
)
test -s "$CLIENT_OUTPUT_FILE"
```

The `noclobber` guard requires a new path and the `umask` creates it
owner-readable only. Report the protected file path and its lifecycle, not the
returned `clientSecret` or file contents.

## Create A Machine Client

A Machine Application has no redirect URI and returns a one-time client secret:

```bash
CLIENT_OUTPUT_FILE=/protected/path/machine-client.json
(
  umask 077
  set -o noclobber
  restish post "$API_NAME/applications" --rsh-print b -o json > "$CLIENT_OUTPUT_FILE" <<'JSON'
{
  "name": "Event Publisher",
  "slug": "event-publisher",
  "clientType": "machine",
  "ownerOrganizationId": "org_123"
}
JSON
)
test -s "$CLIENT_OUTPUT_FILE"
```

Add `resourceScopes` when the workload needs a Resource Server allowlist. Token
exchange becomes usable after a federated credential is configured on the
Application.

## Update Client Resources

Read the current Application first. Use `PATCH /applications/{applicationId}`
for representation fields and the dedicated subresources for replace/create
semantics:

```bash
restish put "$API_NAME/applications/$APPLICATION_ID/redirect-uris" --rsh-print b -o json <<'JSON'
{"redirectUris": ["https://app.example.com/oidc/callback"]}
JSON

restish post "$API_NAME/applications/$APPLICATION_ID/client-secrets" --rsh-print b -o json > "$CLIENT_OUTPUT_FILE"
```

The redirect URI operation replaces the complete collection. Client-secret
creation returns a one-time `clientSecret`; its list operation returns metadata
only. Federated credentials live under
`/applications/{applicationId}/federated-credentials` and use their published
GET, POST, PATCH, and DELETE contracts.

Do not send `oidcClaims` in new integrations. During the compatibility window,
create and update accept the legacy field but ignore it. Application responses
return the fixed profile. Access tokens retain approved Resource scopes and
effective Resource roles. A private Application ID Token contains the string
`urn:realmroot:params:oauth:org` claim and, when `groups` is granted, the user's
Team names in that Organization. ID Tokens never contain Resource roles or
Resource scopes, and UserInfo remains identity-only. Public Applications do not
inherit their owner Organization or Teams for external users.

Use `deviceLoginEnabled` on a `public_native` Application to enable or disable
the device-code grant.

## Use Device Authorization

Use device authorization only with `public_native` clients that have
`deviceLoginEnabled: true`, and consume the
issuer's discovery metadata:

1. Request a device code with `client_id` and product scopes.
2. Show `user_code` and `verification_uri`.
3. Let the user sign in and decide.
4. Poll according to RFC 8628, including `authorization_pending`, `slow_down`,
   `access_denied`, and `expired_token`.
5. Consume the OAuth/OIDC response through the product's OIDC library.
