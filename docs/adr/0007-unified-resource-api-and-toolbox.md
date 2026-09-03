# 0007 — Publish one resource API for Toolbox clients

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

Humans, Agents, Applications, and automation need the same product resources.
Maintaining a separate Agent CLI or action-oriented API would duplicate policy
and make generated tools diverge from the product contract.

## Decision

Publish one resource-oriented management API and one authoritative OpenAPI
document at `/api/openapi.json`. Console browser sessions, Agent DPoP tokens,
and Application credentials enter through different authentication boundaries
but reach the same management resources and authorization model. Account Center
and hosted authentication retain their same-origin browser endpoints because
they are session workflows, not a second public management API. Realmroot
Toolbox uses the OpenAPI contract and its Restish CLI extensions to expose
resource-first operations; generic verb-first HTTP remains a client capability
rather than a second API design.

## Consequences

- Resource nouns, canonical URIs, standard methods, errors, pagination, and
  idempotency are part of the public compatibility contract.
- Realmroot does not maintain a parallel product-specific command-line API.
- The OpenAPI runtime contract and implementation must be verified together.

## Alternatives considered

- Separate browser and Agent APIs: rejected because policy and representations
  would drift.
- Hand-maintained CLI commands: rejected because they duplicate the discoverable
  OpenAPI contract.

## References

- [Resource API](../api/resource-api.md)
- [Unified API specification](../../specs/management-api.feature)
- [OpenAPI composition](../../server/http/openapi/management.ts)
