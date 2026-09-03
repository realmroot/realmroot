# Provider Adapter Runtime Reference

This is the current operational contract for an external Provider Adapter. The
decision and rationale live only in [ADR 0004](../adr/0004-provider-compatibility-through-external-adapters.md).

## Published operation boundary

- An Adapter exposes only operations explicitly published in its OpenAPI
  document. It never accepts an arbitrary upstream URL.
- Every operation has a deterministic provider-permission to Agent-scope
  mapping.
- For a published operation, the Adapter preserves the provider method, path,
  query, body, response, error, retry, and idempotency semantics.
- Header sanitization, credential substitution, scope enforcement, and audit
  correlation happen at the Adapter boundary.
- Compatibility transformations stay in the provider module and every
  transformation is documented.
- Provider authority that is revoked, reduced, expired, ambiguous, or cannot be
  refreshed safely fails closed.

## Ownership

| Artifact or behavior | Owner |
| --- | --- |
| Stable Agent identity, controller approval, Agent Permission | Realmroot |
| Connector identity and generic external Resource connection | Realmroot |
| Provider credentials, refresh, revocation, and lifecycle signals | Adapter provider module |
| Provider permission mapping and published operations | Adapter |
| Final external DPoP token | Adapter authorization server |
| Business object authorization and operation result | Provider API through the Adapter boundary |

Realmroot returns the external final token unchanged. It does not proxy provider
business traffic or add provider-specific authorization branches.

## Authorization details

RFC 9396 authorization details are used only when one connected provider
identity contains independently selectable execution authorities. Realmroot
checks their generic structure, declared type, subset, and replay properties;
the Adapter owns and enforces their provider-specific meaning.
