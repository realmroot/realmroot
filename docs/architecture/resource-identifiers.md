# Resource identifiers

Status: accepted for Realmroot v1.0

## Decision

Realmroot generates new persistent resource and event-record identifiers as
canonical, lowercase UUID version 7 strings without resource-type prefixes.
Identifier generation is an injected use-case port. The Cloudflare Workers
adapter uses the RFC 9562 UUIDv7 implementation from `uuid`, and Better Auth
uses the same generator through its database ID hook.

Existing prefixed identifiers remain valid references and are not rewritten.
HTTP parameters therefore remain opaque strings wherever historical records can
be addressed.

## Boundaries

This policy does not apply to credentials, access or refresh tokens, JWT `jti`
values, request trace identifiers, protocol nonce values, or deterministic
natural keys. Those values retain the format and entropy requirements of their
own protocol or security boundary.

## Consequences

- New identifiers are standard, globally unique, and broadly time ordered.
- D1 may contain both historical prefixed identifiers and new UUIDv7 values.
- Identifier timestamps are observable and must not be treated as secrets.
- Possession of an identifier never grants access; authentication and
  authorization remain mandatory.
