# 0011 — Use UUIDv7 for persistent identifiers

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

Prefixed identifiers coupled durable identity to resource names and required
custom generation rules. Realmroot needs standard, globally unique identifiers
that work across D1, Better Auth, API resources, events, and idempotent creation.

## Decision

Generate new persistent resource and event identifiers as canonical lowercase
UUID version 7 strings without resource-type prefixes. Identifier generation is
an injected port; the Cloudflare adapter and Better Auth database hook use the
same implementation.

Existing prefixed identifiers remain valid opaque references and are not
rewritten. The Agent creation path may recognize retired deterministic IDs only
to replay a creation committed by an earlier release; it never uses those IDs
for a new resource.

Credentials, tokens, JWT `jti` values, nonces, trace identifiers, natural keys,
and idempotency keys keep the format required by their own boundary.

## Consequences

- New persistent IDs are standard and broadly time ordered.
- Historical and UUIDv7 identifiers can coexist, so HTTP parameters remain
  opaque strings.
- UUIDv7 timestamps are observable and identifiers are never treated as secrets
  or authorization evidence.

## Alternatives considered

- Continue generating resource-prefixed IDs: rejected because the prefixes add
  a private format without enforcing resource type or authority.
- Rewrite historical IDs: rejected because it would break durable references
  and audit history.

## References

- [UUIDv7 adapter](../../server/adapters/identifiers/uuid-v7.ts)
- [Agent creation use case](../../server/usecases/agent-identities.ts)
- [Management API specification](../../specs/management-api.feature)
