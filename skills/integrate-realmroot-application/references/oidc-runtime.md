# Realmroot OIDC Runtime

Use this reference to select and implement the product-facing OAuth or OpenID
Connect flow. Realmroot's live discovery document remains authoritative.

## Discover The Issuer

The issuer is the Realmroot authentication mount, not the site origin:

```text
AUTH_ORIGIN/api/auth
```

Discover endpoints and supported features at:

```text
AUTH_ORIGIN/api/auth/.well-known/openid-configuration
```

Do not copy authorization, token, UserInfo, JWKS, device authorization, or
logout endpoint paths into application code when the selected library can
consume discovery metadata.

## Select The Client

| Client type | Runtime | Secret | Required behavior |
| --- | --- | --- | --- |
| `public_spa` | Browser-only application | No | Authorization code with PKCE S256 |
| `public_native` | Mobile, desktop, CLI, runner | No | Authorization code with PKCE S256; device authorization when needed |
| `confidential_web` | Server-side callback and session owner | Yes | Authorization code; authenticate only from the protected server |

Request `openid profile email` for a normal sign-in. Add `offline_access` only
when the product intentionally uses refresh credentials. Use client credentials
only for an approved confidential workload that acts without a user; it is not
a user sign-in flow.

## Implement Authorization Code

- Generate fresh high-entropy `state`, `nonce`, and PKCE verifier values for
  each attempt.
- Store attempt state in a secure, short-lived, same-browser binding.
- Send the S256 code challenge and exact registered redirect URI.
- On callback, reject missing, expired, replayed, or mismatched state before
  exchanging the code.
- Exchange a code once. Public clients send the verifier and no client secret.
- Validate the ID token with discovered issuer metadata and JWKS. Require exact
  issuer, intended audience, valid signature and lifetime, and matching nonce.
- Derive the product session only from validated results.

## Store Credentials And Sessions

- Keep a confidential client secret and refresh credentials out of browser
  bundles, URLs, logs, command output, and source control.
- Prefer an HTTP-only, Secure, SameSite session cookie for server-owned Web
  sessions.
- Keep browser access tokens in the narrowest available runtime boundary; do
  not persist them by default.
- Rotate or replace the stored refresh credential with every successful refresh
  when the provider returns a new one.
- Treat OAuth failure responses as explicit product states. Do not silently
  downgrade from PKCE, token validation, or confidential authentication.

## Implement Native And Device Flows

Use a claimed HTTPS redirect, application link, or loopback redirect appropriate
to the native platform. Bind the returning authorization to the initiating
process and retain the PKCE verifier only for that attempt.

Use device authorization only when the client cannot reliably receive a browser
redirect. Display the verification URI and user code, respect the advertised
polling interval and expiry, and stop on success, denial, or expiration.

## Implement Logout

Define separately:

- ending the product's local session;
- revoking or discarding refresh credentials;
- requesting provider logout when the product intends to end the shared
  Realmroot browser session.

Redirect only to a registered post-logout destination. Do not imply that local
logout necessarily ended every Realmroot or sibling-application session.
