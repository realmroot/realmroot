# 0005 — Keep OAuth tokens outside browser JavaScript

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

Account Center and Realm Console perform identity and administrative operations.
Persisting their OAuth access or refresh tokens in browser JavaScript would
turn any same-origin script compromise into credential exfiltration.

## Decision

Realmroot's hosted browser surfaces use the same-origin Better Auth session
boundary with secure server-managed cookies. OAuth and OIDC tokens are issued
to registered clients and Resource Servers; they are not the Account Center or
Console SPA's credential. Server authorization remains authoritative for every
operation.

## Consequences

- Browser code never stores privileged OAuth tokens in local or session
  storage.
- Cookie, CSRF, trusted-origin, session rotation, and security-header behavior
  are release-critical boundaries.
- A future direct browser-token design requires a superseding security ADR.

## Alternatives considered

- Persist access and refresh tokens in browser storage: rejected because XSS
  would expose long-lived authority.
- Treat an ID token as an API credential: rejected because identity assertions
  do not authorize Resource operations.

## References

- [Auth provider](../architecture/auth-provider.md)
- [Security controls](../architecture/security-controls.md)
- [Browser auth client](../../src/lib/auth-client.ts)
- [Better Auth server boundary](../../server/auth.ts)
