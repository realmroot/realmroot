# Auth Provider Architecture

Status: accepted for Realmroot v1.0

## Decision

Realmroot v1.0 uses `@better-auth/oauth-provider` as the long-term OAuth 2.1 and OIDC provider basis. The previous `better-auth/plugins` `oidcProvider` plugin is not the v1.0 basis because the Better Auth v1.6 documentation marks it as soon to be deprecated in favor of the OAuth Provider plugin.

The selected provider is configured in `server/auth.ts` with:

- `jwt()` so OAuth access tokens and ID tokens are remotely verifiable through JWKS.
- RS256 as the active ID-token signing algorithm required by the OpenID Connect
  Discovery interoperability baseline. Superseded EdDSA and ES256 public keys
  remain published during the configured JWKS grace period so already-issued
  tokens can still be verified.
- Better Auth 1.6 is patched to select the newest live key matching the configured
  signing algorithm instead of the newest key of any algorithm. This keeps
  algorithm rotation safe while the JWKS contains rollover keys.
- `oauthProvider()` from `@better-auth/oauth-provider`.
- OIDC scopes: `openid`, `profile`, `email`, `offline_access`.
- Dynamic client registration disabled by default.
- Hashed client secrets and hashed stored OAuth tokens.
- Better Auth `/token` disabled so the OAuth token boundary is `/oauth2/token`.
- Native API Resource tokens use the same Better Auth JWT/JWKS
  lifecycle after an Agent access request is approved.

Realmroot v1.0 is intentionally a single user pool auth realm. Multiple OIDC
applications can share the same provider instance, but they share users,
administrators, login methods, connector configuration, and security policy.
Products that need separate user pools use separate Realmroot deployments. See
[Tenancy Model](tenancy.md).

The issuer is the Better Auth mounted issuer, not the bare site origin:

```text
{BETTER_AUTH_URL or request origin}/api/auth
```

This keeps every interactive and token endpoint under `/api/auth/oauth2/*`. Because OAuth Authorization Server metadata uses path insertion for issuers with paths, `server/app.ts` also mounts:

```text
/.well-known/oauth-authorization-server/api/auth
```

OIDC discovery remains at:

```text
/api/auth/.well-known/openid-configuration
```

## Provider Capability Spike

| Capability | v1.0 result | Notes |
| --- | --- | --- |
| Discovery metadata | Supported | OIDC discovery is served by the auth handler; OAuth Authorization Server metadata is mounted at the issuer-path well-known route. |
| JWKS | Supported | Requires `jwt()`; JWKS URI is advertised by provider metadata. |
| Authorization code + PKCE | Supported | OAuth Provider is OAuth 2.1 oriented and only advertises S256 code challenge support. |
| Confidential clients | Supported | Stored client secrets are hashed. Secret material is only returned at creation/rotation time. |
| Public SPA/native clients | Supported with metadata limitation | Admin/server-created clients can use `token_endpoint_auth_method: "none"` and PKCE. Better Auth 1.6.10 does not advertise `none` in `token_endpoint_auth_methods_supported` while unauthenticated dynamic registration remains disabled, so client onboarding must document the auth method from the client record rather than relying on discovery metadata alone. |
| Refresh tokens | Supported | `offline_access` is included and refresh tokens are stored separately in `oauth_refresh_token`. |
| Consent flow | Supported | Consent is redirected to `/oauth/consent`; grants are stored in `oauth_consent`. |
| UserInfo | Supported | Available when `openid` is in the granted scope set. |
| Scopes | Supported | OIDC scopes remain `openid profile email offline_access`; API resource scopes are managed under `/api/management/api-resources/{id}/scopes` and are passed into the authorization claim builder for matching audience/resource requests. |
| Resource indicators | Supported | API resources define valid audiences. When a token request includes a matching resource/audience, Realmroot emits audience/resource authorization metadata and RBAC claims for that API resource. |
| Client credentials | Supported | The selected plugin supports `client_credentials`; v1.0 treats these as machine tokens without a user subject. |
| Agent API access | Supported | Both API Resource modes use Agent access requests and grants. Native resources receive Realmroot-signed DPoP JWTs; external resources receive target-issued tokens through standard target OAuth protocols. |

## Token Shape

Access tokens are JWT-verifiable when issued for a valid audience through the JWT plugin. Opaque OAuth access tokens are retained for flows where the provider stores a database token. Refresh tokens are opaque and stored hashed in `oauth_refresh_token`.

Standard claims come from the provider/JWT layer:

- `iss`: `{baseURL}/api/auth`
- `aud`: `{baseURL}/api/auth` for provider tokens, or the matched API resource audience when the OAuth provider issues a resource-bound token
- `sub`: user id for user grants; absent from client-credentials grants unless a future machine identity model adds a subject
- `azp`: OAuth client id
- `scope`: granted scope string; resource scopes are also mirrored into `authorization.scopes`
- `sid`: session id for user-bound grants when available

Authorization claims are added by the authorization module through the Better Auth OAuth provider access-token claim hook:

- `authorization.scopes`: granted scopes as an array
- `authorization.roles`: RBAC role keys assigned directly to the user, to the application, or to the user's organization member record
- `authorization.permissions`: permission keys attached to those roles
- `authorization.organization_id`: present for organization-scoped token construction
- `authorization.resource` and `authorization.audience`: present when the requested audience matches an enabled API resource
- Top-level `roles` and `permissions`: duplicated arrays for clients that expect simple RBAC claims

Native API Resource Agent tokens use the same `iss` and JWKS. The controlling
user or organization is `sub`, `act` carries the Agent/Host actor chain, and
`cnf.jkt` binds the token to its DPoP key.

Workload token exchange accepts only RS256 or ES256 assertions whose issuer,
subject pattern, audience, and verification key are registered on the calling
application's federated credential. Exchanged opaque tokens are introspectable
only by that confidential client. Assertion-private claims are returned under
`urn:realmroot:params:oauth:token-exchange:subject-claims`; they can never
replace authorization-server-controlled introspection fields. `offline_access`
uses hashed opaque refresh tokens with one-time rotation. Reuse revokes the
whole token family, and every refresh rechecks client authentication, allowed
scope, and federated-credential status.

Role assignments can contribute extra token claims, but reserved claim names are rejected at assignment time. Role `tokenClaimName` values are emitted either at the top level or under the API resource `tokenClaimsNamespace` when the resource defines one. Team management remains out of scope; organization membership roles are included through the existing organization member model.

## Client Model

OAuth clients are first-class provider records in `oauth_client`.

- Confidential clients use `client_secret_basic` or `client_secret_post`.
- Public browser, native, CLI, and SPA clients use `token_endpoint_auth_method: "none"` and must use PKCE S256. In Better Auth 1.6.10, the discovery document still advertises only `client_secret_basic` and `client_secret_post` when unauthenticated dynamic registration is disabled; this is an accepted v1.0 metadata limitation, not permission to enable unsafe public registration.
- Dynamic client registration stays disabled for v1.0. Clients are created by admin/server-side workflows.
- `skipConsent` is reserved for trusted first-party clients only.
- Client ownership is currently user-based through `user_id`; `reference_id` is reserved for future organization-owned clients.

## Product Application Integration

Product applications integrate with Realmroot as a standard OIDC provider. They
should not call Realmroot `/api/management/*` or `/api/account/*` routes and do
not need a Realmroot custom SDK.

Use discovery to get the current protocol endpoints:

```bash
REALMROOT_ORIGIN=https://auth.example.com
curl "$REALMROOT_ORIGIN/api/auth/.well-known/openid-configuration"
```

The issuer is:

```text
https://auth.example.com/api/auth
```

Public browser, native, SPA, and CLI clients use authorization code with PKCE
S256. Generate a verifier and challenge in the product app, save the verifier
and `state` in same-site app state, then redirect:

```js
const verifierBytes = crypto.getRandomValues(new Uint8Array(32))
const verifier = btoa(String.fromCharCode(...verifierBytes))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')
const challengeBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')

const authorizeUrl = new URL('https://auth.example.com/api/auth/oauth2/authorize')
authorizeUrl.search = new URLSearchParams({
  client_id: 'public-client-id',
  redirect_uri: 'https://app.example.com/auth/callback',
  response_type: 'code',
  scope: 'openid profile email offline_access',
  state: crypto.randomUUID(),
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString()

location.assign(authorizeUrl)
```

On callback, reject the response unless the returned `state` exactly matches the
saved value. Exchange the callback `code` with the saved verifier. Public-client
records use `token_endpoint_auth_method: "none"` and send no client secret, even
though Better Auth 1.6.10 currently omits `none` from discovery metadata while
unauthenticated dynamic registration is disabled:

```bash
curl -X POST "$REALMROOT_ORIGIN/api/auth/oauth2/token" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'client_id=public-client-id' \
  --data-urlencode 'redirect_uri=https://app.example.com/auth/callback' \
  --data-urlencode 'code=AUTHORIZATION_CODE_FROM_CALLBACK' \
  --data-urlencode 'code_verifier=SAVED_PKCE_VERIFIER'
```

Confidential server-side clients use the same authorization request and include
client authentication at the token endpoint:

```bash
curl -X POST "$REALMROOT_ORIGIN/api/auth/oauth2/token" \
  -u 'confidential-client-id:one-time-client-secret' \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'redirect_uri=https://app.example.com/auth/callback' \
  --data-urlencode 'code=AUTHORIZATION_CODE_FROM_CALLBACK'
```

Use the advertised `jwks_uri` to verify JWT access tokens and ID tokens. Call the
advertised `userinfo_endpoint` with a bearer access token when the product needs
normalized OpenID profile claims. Request `offline_access` only when the product
needs refresh tokens.

Better Auth applications can use Realmroot as an OIDC-compatible upstream through
the generic OAuth plugin:

```ts
import { betterAuth } from 'better-auth'
import { genericOAuth } from 'better-auth/plugins'

export const auth = betterAuth({
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: 'realmroot',
          discoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
          issuer: 'https://auth.example.com/api/auth',
          clientId: process.env.REALMROOT_CLIENT_ID!,
          clientSecret: process.env.REALMROOT_CLIENT_SECRET,
          redirectURI: 'https://app.example.com/api/auth/callback/realmroot',
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
        },
      ],
    }),
  ],
})
```

## Secret Handling

- `BETTER_AUTH_SECRET` remains the root Better Auth signing secret and must be configured per environment.
- OAuth client secrets are stored hashed by the provider.
- OAuth access and refresh tokens are stored hashed by the provider.
- Plain client secrets are shown only when created or rotated.
- No fallback issuer or secret defaults are allowed in production.

## Schema Implications

The OAuth Provider plugin replaces the old OIDC Provider schema:

- `oauth_application` is removed.
- `oauth_client` is added for registered clients and client metadata.
- `oauth_refresh_token` is added for `offline_access` refresh grants.
- `oauth_access_token` now stores provider tokens by `token`, optional `session_id`, optional `reference_id`, optional `refresh_id`, and `expires_at`.
- `oauth_consent` no longer stores `consent_given`; an existing row represents a granted consent record.

The migration intentionally drops the old spike provider tables instead of trying to preserve old OIDC Provider rows because the model names and token storage semantics changed.

## Better Auth Device Approval

Realmroot installs Better Auth's Device Authorization plugin for guarded public native client approval. This is Better Auth device approval plumbing for a signed-in browser session; it is not currently a standards-compliant Realmroot OAuth/OIDC device-code token flow.

The hosted verification URI is:

```text
https://auth.example.com/device
```

Native clients request a device authorization code at:

```bash
curl -X POST "$REALMROOT_ORIGIN/api/auth/device/code" \
  -H 'content-type: application/json' \
  -d '{"client_id":"native-client-id","scope":"openid profile email offline_access"}'
```

The response includes `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in`, and `interval`. The browser verification page requires a signed-in Realmroot session before approval or denial, and hosted sign-in preserves the verification return path.

Only public native clients explicitly configured with Better Auth device approval can start the flow. Public SPA clients, confidential web clients, disabled clients, and clients requesting disallowed scopes are rejected before code issuance.

Realmroot patches Better Auth v1.6.25 so `@better-auth/oauth-provider` accepts `urn:ietf:params:oauth:grant-type:device_code` at `/api/auth/oauth2/token` after Better Auth device approval. Successful polling returns OAuth Provider token material: a JWKS-compatible access token when a resource audience is requested, an ID token when `openid` is granted, and a refresh token when `offline_access` is granted. OIDC discovery advertises `device_authorization_endpoint` and the device-code grant.

## v1.0 Better Auth Plugin Matrix

| Plugin | v1.0 decision | Implementation note |
| --- | --- | --- |
| OAuth Provider/OIDC | Include | Implemented with `@better-auth/oauth-provider`. |
| Admin | Include | Implemented with `admin()`. |
| Organization | Include | Use Better Auth `organization()` with `teams.enabled: false`; schema and UI are separate follow-up work. |
| Two-Factor | Include | Use `twoFactor()` after account settings and recovery UX are implemented. |
| Passkey | Include | Use `@better-auth/passkey`; add passkey table and client plugin with WebAuthn origin rules. |
| Email OTP | Include | Requires Cloudflare-native email delivery before enabling. |
| Username | Include | Add username fields and policy before enabling. |
| Generic OAuth/social | Include | Use `genericOAuth()` for configured social/custom upstream providers. |
| Device Authorization | Include | Use Better Auth `deviceAuthorization()` for native-client browser approval and a Realmroot-maintained Better Auth patch to exchange approved device codes through the OAuth Provider token endpoint. |
| OpenAPI | Include if stable enough | Better Auth v1.6 exposes `openAPI()`; keep it behind review before public exposure. |

## Explicit Exclusions

Realmroot v1.0 excludes enterprise SSO, SAML, LDAP, SCIM, audit logs, teams, payments, crypto/wallet auth, anonymous auth, and phone/SMS auth.

Phone/SMS auth can be reconsidered only if there is a Cloudflare-native SMS path that meets the same deployment and secret-handling boundaries as email.
