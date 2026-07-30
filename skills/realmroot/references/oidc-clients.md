# Product OIDC Clients

Use this reference together with `management.md` when the user asks to
configure a product OIDC client.

## Contents

- [Select the client](#select-the-client)
- [Create a browser client](#create-a-browser-client)
- [Create a native client](#create-a-native-client)
- [Create a confidential client](#create-a-confidential-client)
- [Use device authorization](#use-device-authorization)

## Select The Client

Use issuer discovery at:

```text
AUTH_ORIGIN/api/auth/.well-known/openid-configuration
```

Choose by runtime:

| Client type | Use for | Secret | Typical grants |
| --- | --- | --- | --- |
| `public_spa` | Browser apps | No | `authorization_code`, `refresh_token` |
| `public_native` | Mobile, desktop, CLI, runners | No | `authorization_code`, `refresh_token`, device code |
| `confidential_web` | Server-side apps that protect secrets | Yes | `authorization_code`, `refresh_token`, optional `client_credentials` |

Use `openid profile email` for common clients. Add `offline_access` only when
refresh tokens are required. Add `client_credentials` only when a confidential
backend must act without a user.

Public clients use PKCE and Realmroot-selected token endpoint authentication.
Keep `firstParty` and `trusted` at their safe default `false`. Set either to
`true` only when the user explicitly requests that policy; `trusted: true`
skips user consent.

Client selection is complete when its runtime, redirects, grants, scopes,
consent policy, and secret-handling capability are explicit.

Treat every name, slug, origin, and redirect in the examples as a template.
Replace it with an exact user-confirmed value before mutation.

List applications before mutation. When a discovered application overlaps the
requested slug, client identity, or redirect URIs, present it and obtain an
explicit choice to reuse, update, or create a distinct client.

## Create A Browser Client

Validate `APP_ORIGIN` as an absolute origin and remove its optional trailing
slash:

```bash
APP_ORIGIN="${APP_ORIGIN%/}"
restish post "$API_NAME/applications" -o json <<JSON
{
  "name": "Customer Portal",
  "slug": "customer-portal",
  "clientType": "public_spa",
  "redirectUris": ["${APP_ORIGIN}/oidc/callback"],
  "postLogoutRedirectUris": ["${APP_ORIGIN}/signed-out"],
  "corsOrigins": ["${APP_ORIGIN}"],
  "allowedGrantTypes": ["authorization_code", "refresh_token"],
  "allowedScopes": ["openid", "profile", "email", "offline_access"]
}
JSON
```

Replace names, routes, grants, and scopes with the consuming product's exact
requirements.

## Create A Native Client

For authorization code:

```bash
restish post "$API_NAME/applications" -o json <<'JSON'
{
  "name": "Desktop App",
  "slug": "desktop-app",
  "clientType": "public_native",
  "redirectUris": ["com.example.desktop:/callback", "http://127.0.0.1:8484/callback"],
  "allowedGrantTypes": ["authorization_code", "refresh_token"],
  "allowedScopes": ["openid", "profile", "email", "offline_access"]
}
JSON
```

For device authorization:

```bash
restish post "$API_NAME/applications" -o json <<'JSON'
{
  "name": "Runner CLI",
  "slug": "runner-cli",
  "clientType": "public_native",
  "redirectUris": ["com.example.runner:/callback"],
  "allowedGrantTypes": ["urn:ietf:params:oauth:grant-type:device_code"],
  "allowedScopes": ["openid", "profile", "email", "offline_access"]
}
JSON
```

## Create A Confidential Client

Validate `APP_ORIGIN` as an absolute origin and remove its optional trailing
slash. Obtain an exact protected output file path from the user before creating
the client, because the response contains its one-time secret:

```bash
APP_ORIGIN="${APP_ORIGIN%/}"
CLIENT_OUTPUT_FILE=/protected/path/client.json
(
  umask 077
  set -o noclobber
  restish post "$API_NAME/applications" -o json > "$CLIENT_OUTPUT_FILE" <<JSON
{
  "name": "Admin Backend",
  "slug": "admin-backend",
  "clientType": "confidential_web",
  "redirectUris": ["${APP_ORIGIN}/oidc/callback"],
  "postLogoutRedirectUris": ["${APP_ORIGIN}/signed-out"],
  "allowedGrantTypes": ["authorization_code", "refresh_token"],
  "allowedScopes": ["openid", "profile", "email", "offline_access"]
}
JSON
)
test -s "$CLIENT_OUTPUT_FILE"
```

The `noclobber` guard requires a new path and the `umask` creates it
owner-readable only. Report the protected file path and its lifecycle, not the
returned `clientSecret` or file contents.

## Use Device Authorization

Use device authorization only with `public_native` clients and consume the
issuer's discovery metadata:

1. Request a device code with `client_id` and product scopes.
2. Show `user_code` and `verification_uri`.
3. Let the user sign in and decide.
4. Poll according to RFC 8628, including `authorization_pending`, `slow_down`,
   `access_denied`, and `expired_token`.
5. Consume the OAuth/OIDC response through the product's OIDC library.
