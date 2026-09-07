# Hosted application device management

An application opens `${REALMROOT_ORIGIN}/application-sessions?client_id=${encodeURIComponent(clientId)}`
in the system browser. For the hosted realm the origin is `https://id.realmroot.dev`.
This navigation convention is Realmroot-specific; it is not an OIDC endpoint.
Only `client_id` is needed. Never put access tokens, refresh tokens, ID tokens,
installation secrets, or credentials in this URL. There is no callback required.

Use Authorization Code + PKCE (S256), with `openid` and `offline_access` and a
client configured for refresh tokens. To manage devices, the client must generate
a random installation ID once and persist it in installation-local storage.
Reuse it across sign-in, sign-out, app updates, and refresh. Do not sync it between
devices or restore it into another installation. Clear data/reinstallation creates
a new ID. No hardware identifier, device attestation, or new OAuth scope is needed.
The realm's existing Account Center session-management setting must be enabled.

Send these additional parameters on the **authorization request**:

| Parameter | Contract |
| --- | --- |
| `installation_id` | Stable installation identifier; 16–128 ASCII letters, digits, `_` or `-`. A random UUID is recommended. Required for device grouping. |
| `device_name` | Optional display name, trimmed, 1–100 characters. Requires `installation_id`. |
| `device_platform` | Optional `android`, `ios`, `macos`, `windows`, `linux`, `web`, or `other`. Requires `installation_id`. |

For example, append `installation_id=550e8400-e29b-41d4-a716-446655440000&device_name=My%20Phone&device_platform=android`
to the existing authorization URL. These values travel through hosted authentication
and consent and are bound to the authorization code. Setting them on token exchange
or refresh cannot override that identity. The ID and names are client assertions,
not credentials; ownership comes from the authenticated user and OAuth client.
They cannot prove physical hardware identity or distinguish clients that deliberately
copy the same installation ID. This feature does not require such attestation.

Unmodified OIDC clients can continue signing in. Without `installation_id`, each
login is an **unidentified session**, not counted as a device. Apps integrating
device management must supply the ID; only the hosted management link needs just
`client_id`. Native clients open that link with their ordinary system-browser API.

The page authenticates with Realmroot's secure browser cookie. Hosted sign-in
preserves the selected application. The page displays both the browser account
and application's name/client ID: this account can differ from the app's account.
Users should verify the account and sign out through the account menu if needed,
then reopen the link with the intended account. `client_id` selects an application;
only the authenticated user owns the listed sessions and can remove them.
The page's backing account API requires a browser session and the existing
trusted-origin boundary; application OAuth tokens cannot operate this UI API.

## Supported unit and field meanings

Device identity is scoped by **user + OAuth client + installation ID**. Repeated
logins on the same installation share one active authorization lifecycle, including
independent refresh chains. Different users or applications never share that
lifecycle. An unidentified login receives its own lifecycle. No current-app-device
badge is shown because the browser management page has no installation identity.
Logins without refresh authorization are not listed.

- **Signed in:** the first issuance in the active authorization lifecycle.
- **Last activity:** latest login or successful credential refresh, not app usage.
- **Name and platform:** client-reported metadata from the latest login; refresh
  cannot change it. Missing names/platforms are shown explicitly as unavailable.
- **Client information:** User-Agent from the latest login's token exchange,
  limited to 512 characters. It may identify an HTTP library rather than hardware.
- **Historical credentials:** existing unrevoked refresh tokens are migrated as
  separate unidentified sessions. Their creation time supplies initial timestamps;
  no installation or rotation ancestry is guessed. `legacy` in the API marks these.

A lifecycle counts once while it is not revoked and has an unrevoked, unexpired
refresh token. The API returns separate total `summary.devices` and
`summary.unidentifiedSessions`; pagination covers both kinds. The existing sliding
30-day refresh lifetime is preserved. Expired lifecycles disappear on read without
a cleanup job and are closed before a subsequent login starts a new lifecycle.

The existing `oauth_refresh_token` table is reused and gains a direct
`application_session_id` reference. One new `application_session` table holds the
authorization lifecycle and installation metadata. There is no token-link table.
Browser `session` cannot own this state: it is shared across applications and may
be deleted while native refresh authorization remains valid. A rotating token row
cannot own it either: multiple current tokens can belong to one installation and
revoked ancestors must retain their original lifecycle. User/client deletion
cascades both records; browser-cookie deletion does not remove app authorization.

## Removal, logout, and reinstallation

Removal atomically revokes the lifecycle and all its current refresh credentials.
A refresh commits either before removal (its child is also revoked) or after it
(and receives `invalid_grant`). Concurrent attempts to consume the same refresh
credential produce at most one successful rotation. Repeated removal is harmless.
All refresh chains belonging to the removed installation are revoked. Other
installations, applications, browser cookies, and users remain unaffected.

On `invalid_grant`, the app clears its unusable login credentials and offers
normal interactive sign-in; it must not retry the same refresh token forever.
Removal does not prohibit future login or remotely delete local files.

For app logout, use standard [OAuth token revocation (RFC 7009)](https://www.rfc-editor.org/rfc/rfc7009)
with the known refresh token at the issuer's discovered revocation endpoint, then
clear local credentials. Realmroot ends that token's complete login lifecycle,
including if the token has already rotated. Browser SSO logout alone does not
revoke application refresh authorization. Local-only logout or uninstall without
revocation leaves the authorization listed until expiration or manual removal;
reinstallation creates a new installation ID. A new login after removal or full
expiration creates a new lifecycle, even if it supplies the same installation ID.
Revoking an old token cannot revoke that new lifecycle. Concurrent logins for the
same installation produce only one active lifecycle.

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
log in twice with the same installation ID and once with a different ID,
verify that two devices appear, remove one device, and check that only its refresh returns `invalid_grant`. Access with its
existing JWT can continue until `exp`; repeat the protected-resource request after
`exp` plus that server's clock tolerance and verify rejection. The other login
must still refresh and access the resource.

## Upgrade boundary

The database migration creates and backfills the lifecycle and adds the direct
reference on existing refresh tokens. During upgrade, pause/drain OAuth token issuance and
refresh traffic before applying the migration, then activate the new Worker
before resuming traffic. Do not run old and new token-issuing Workers together:
the old provider cannot create or enforce these associations. Do not roll back
to an old token provider while this page remains available. Existing token values
and expiration dates are preserved; migrated credentials continue rotating under
the new lifecycle. This PR does not perform a deployment.
