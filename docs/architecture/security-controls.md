# Security Controls

FlareAuth uses Better Auth for MFA, passkey, and session enforcement. Product APIs under `/api/account/security` and `/api/admin/security` wrap those Better Auth capabilities with resource-oriented account and admin views.

## Deployment Policy

Security policy is deployment-level in v1.0:

- `MFA_POLICY`: `optional` or `required`; defaults to `optional`.
- `PASSKEY_ENABLED`: `true` or `false`; defaults to `true`.
- `SESSION_DURATION_SECONDS`: Better Auth session TTL; defaults to 7 days.
- `SESSION_UPDATE_AGE_SECONDS`: session refresh interval; defaults to 1 day.
- `SESSION_FRESH_AGE_SECONDS`: sensitive-operation freshness window; defaults to 1 day.
- `SESSION_COOKIE_CACHE_SECONDS`: Better Auth cookie cache TTL; defaults to 5 minutes.

`MFA_POLICY=required` is exposed through the security policy API for clients and administrators. Better Auth two-factor challenge enforcement still applies to Better Auth credential sign-in flows; passwordless and OAuth flows need client flow handling before treating sign-in as complete.

## WebAuthn Origin And RP ID

Passkey registration and authentication use explicit WebAuthn config:

- `WEBAUTHN_RP_ID`: the relying party ID. Defaults to the hostname of `BETTER_AUTH_URL` or the request origin.
- `WEBAUTHN_RP_NAME`: display name shown by authenticators. Defaults to `FlareAuth`.
- `WEBAUTHN_ORIGINS`: comma-separated origin allowlist for WebAuthn ceremonies. Defaults to `TRUSTED_ORIGINS`.

Production should use the stable auth hostname as `WEBAUTHN_RP_ID`, or a parent domain only when every production auth origin is a subdomain of that parent. Cloudflare preview deployments should use the exact preview hostname as the RP ID and the exact preview origin in `WEBAUTHN_ORIGINS`. Preview passkeys are intentionally isolated from production passkeys.
