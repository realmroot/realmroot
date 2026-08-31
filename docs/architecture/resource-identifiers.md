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

Agent creation follows the same rule for the stable Agent resource identifier,
OIDC subject, installation binding, audit event, and internal idempotency
reservation. An application creation reservation durably maps its application,
represented User, and `Idempotency-Key` to the generated Agent and a canonical
request fingerprint; the reservation identifier is never derived from that key.

When a reservation is absent during the UUIDv7 rollout, Realmroot may derive
the retired prefixed identifiers solely to locate and validate a creation that
was committed by the previous release. A matching historical Agent receives a
UUIDv7 reservation lazily; the derived values are never used to create another
resource or event.

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
