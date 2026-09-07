# Hosted application login-session management

An application opens `${REALMROOT_ORIGIN}/application-sessions?client_id=${encodeURIComponent(clientId)}`
in the system browser. For the hosted realm the origin is `https://id.realmroot.dev`.
This navigation convention is Realmroot-specific; it is not an OIDC endpoint.
Only `client_id` is needed. Never put access tokens, refresh tokens, ID tokens,
installation secrets, or credentials in this URL. There is no callback required.

Keep the existing Authorization Code + PKCE (S256) login, with `openid` and
`offline_access` and a client configured for refresh tokens. Native Android,
iOS, macOS, Windows, and Linux clients use their ordinary platform browser-open
operation. No Sublyra-specific registration, installation ID, proprietary login
protocol, device API client, or new OAuth scope is required. The realm's existing
Account Center session-management setting must be enabled.

The page authenticates with Realmroot's secure browser cookie. Hosted sign-in
preserves the selected application. The page displays both the browser account
and application's name/client ID: this account can differ from the app's account.
Users should verify the account and sign out through the account menu if needed,
then reopen the link with the intended account. `client_id` selects an application;
only the authenticated user owns the listed sessions and can remove them.
The page's backing account API requires a browser session and the existing
trusted-origin boundary; application OAuth tokens cannot operate this UI API.

## Supported unit and field meanings

Each successful login that issues refresh credentials establishes an **application
login session** with a stable, opaque identity. This is an independent refresh
rotation lifecycle, not a physical device or verified installation. Two logins on
the same installation count twice, even if they share one browser SSO session.
No current-app-device badge is shown because the browser cannot prove that mapping.
Logins without refresh authorization are not listed.

- **Signed in:** time Realmroot issued the initial refresh authorization, not the
  time the shared browser cookie was created.
- **Last activity:** initial issuance or latest successful refresh-token rotation;
  it does not track playback, API access, or foreground app activity.
- **Client information:** the User-Agent supplied to the initial token exchange,
  truncated to 512 characters. It is client-reported, may identify an HTTP library
  rather than the OS, and is not verified hardware identity. Missing data is shown
  as unavailable. No additional client metadata is required.
- **Historical login authorization:** an existing refresh credential migrated
  without known family ancestry. Historical rows cannot be reliably merged into
  installations or reconstructed logins; each receives its own lifecycle. Its
  sign-in and last-activity time use that credential's creation time. Future
  rotations preserve this identity and update last activity.

A session counts once while it is not removed and has an unrevoked, unexpired
refresh credential. Pagination reports the total active count; rotation never
increases it. The provider retains its existing sliding 30-day refresh lifetime.
Expiration filters the session from subsequent reads without a cleanup job.
Revoked/expired lifecycle records and token links remain for stable repeated
removal and ancestry; deletion of the user or OAuth client cascades their removal.
The original browser-session link may become null without destroying this model.

## Removal, logout, and reinstallation

Removal atomically revokes the lifecycle and all its current refresh credentials.
A refresh commits either before removal (its child is also revoked) or after it
(and receives `invalid_grant`). Concurrent attempts to consume the same refresh
credential produce at most one successful rotation. Repeated removal is harmless.
Other logins, applications, browser cookies, and users remain unaffected.

On `invalid_grant`, the app clears its unusable login credentials and offers
normal interactive sign-in; it must not retry the same refresh token forever.
Removal does not prohibit future login or remotely delete local files.

For app logout, use standard [OAuth token revocation (RFC 7009)](https://www.rfc-editor.org/rfc/rfc7009)
with the known refresh token at the issuer's discovered revocation endpoint, then
clear local credentials. Realmroot ends that token's complete login lifecycle,
including if the token has already rotated. Browser SSO logout alone does not
revoke application refresh authorization. Local-only logout or uninstall without
revocation leaves the authorization listed until expiration or manual removal;
reinstallation and another login create a separate session.

## Access-token enforcement window

Realmroot currently issues these user access JWTs for 3,600 seconds. Removal stops
refreshing but does not retroactively revoke an already-issued JWT. An offline
resource server must check signature, issuer, audience, and `exp`; access may
continue for the remaining token lifetime (at most one hour from issuance), plus
any configured clock tolerance. A refresh that committed before removal can
return its already-issued access JWT while its refresh token is unusable.

Do not claim immediate resource-server logout. The current JWT introspection path
also validates the issued JWT rather than this application-session lifecycle, so
calling introspection does not shorten this window. [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662)
permits introspection but its use requires an explicit resource-server integration;
any future revocation-aware implementation must account for cache TTL as well.
Back-channel logout notifications and device-code authorization are not added by
this feature and are not substitutes for resource-server token enforcement.

The integration test verifies an issued JWT against the real local JWKS after
removal and rejects it at its `exp`. To accept an application's integration,
log in twice, open the management link, verify the browser account, remove one
session, and check that only its refresh returns `invalid_grant`. Access with its
existing JWT can continue until `exp`; repeat the protected-resource request after
`exp` plus that server's clock tolerance and verify rejection. The other login
must still refresh and access the resource.

## Upgrade boundary

The additive database migration creates and backfills the session lifecycle and
its token associations. During upgrade, pause/drain OAuth token issuance and
refresh traffic before applying the migration, then activate the new Worker
before resuming traffic. Do not run old and new token-issuing Workers together:
the old provider cannot create or enforce these associations. Do not roll back
to an old token provider while this page remains available. Existing token values
and expiration dates are preserved; migrated credentials continue rotating under
the new lifecycle. This PR does not perform a deployment.
