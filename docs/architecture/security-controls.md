# Security Controls Reference

Realmroot uses Better Auth for MFA, passkey, and session enforcement. Product
APIs under `/api/account/security` and `/api/realm/security-policy` wrap those
capabilities with resource-oriented account and Realm-administration views.

## Deployment Policy

Security policy is Realm-wide. Environment values provide deployment defaults;
Console and the Resource API persist managed overrides in D1. Request handling
loads the effective policy and applies it to Better Auth, hosted authentication,
and protected account and management operations.

The deployment defaults are:

- `MFA_POLICY`: `optional` or `required`; defaults to `optional`.
- `PASSKEY_ENABLED`: `true` or `false`; defaults to `true`.
- `SESSION_DURATION_SECONDS`: Better Auth session TTL; defaults to 7 days.
- `SESSION_UPDATE_AGE_SECONDS`: session refresh interval; defaults to 1 day.
- `SESSION_FRESH_AGE_SECONDS`: sensitive-operation freshness window; defaults to 1 day.
- `SESSION_COOKIE_CACHE_SECONDS`: Better Auth cookie cache TTL; defaults to 5 minutes.

Managed policy also covers authenticator and email-OTP availability, backup
codes, password rules, CAPTCHA, and sign-in blocklists. The management response
reports whether a CAPTCHA secret is configured without returning the secret.

When MFA is required, the API middleware blocks an authenticated User from
non-enrollment operations until MFA is enabled. Better Auth still owns the
second-factor challenge during supported credential sign-in flows.

## WebAuthn Origin And RP ID

Passkey registration and authentication use explicit WebAuthn config:

- `WEBAUTHN_RP_ID`: the relying party ID. Defaults to the hostname of `BETTER_AUTH_URL` or the request origin.
- `WEBAUTHN_RP_NAME`: display name shown by authenticators. Defaults to `Realmroot`.
- `WEBAUTHN_ORIGINS`: comma-separated origin allowlist for WebAuthn ceremonies. Defaults to `TRUSTED_ORIGINS`.

Production should use the stable auth hostname as `WEBAUTHN_RP_ID`, or a parent domain only when every production auth origin is a subdomain of that parent. Cloudflare preview deployments should use the exact preview hostname as the RP ID and the exact preview origin in `WEBAUTHN_ORIGINS`. Preview passkeys are intentionally isolated from production passkeys.
