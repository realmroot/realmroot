# 0012 — Preserve history with explicit lifecycle semantics

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

Identity and authorization records remain relevant to audit after their active
lifecycle ends. At the same time, ordinary business names should not be blocked
forever by a deleted resource. Applying one deletion mechanism to every table
would either erase security history or reserve reusable names unnecessarily.

## Decision

Choose lifecycle semantics per public resource: hard delete disposable
relationships, revoke or end durable authorization facts in place, and soft
delete primary resources whose history must survive. The default for a
soft-deleted resource is active-record uniqueness, so deletion releases its
business keys while generated IDs and history remain.

Stable security identities are explicit exceptions. An Agent's issuer/subject,
username, and installation binding remain permanently reserved after deletion
or revocation so a new principal cannot inherit historical identity. Replay
protection, token hashes, version numbers, and idempotency records are likewise
never reusable identities.

The OpenAPI contract owns the public operations, BDD specifications own
selected observable guarantees, and the current resource-by-resource behavior
is recorded in the lifecycle reference. Database constraints enforce the
corresponding key policy.

## Consequences

- Deletion does not silently mean restoration, disablement, or revocation.
- A newly created Resource Server may reuse a deleted Resource Server's
  identifier or URL, but it receives a new generated ID and no historical
  authority.
- A deleted Agent identity cannot be recreated under the same public identity.
- New resource types must select lifecycle and business-key behavior explicitly.

## Alternatives considered

- Hard delete every resource: rejected because it destroys authorization and
  audit lineage.
- Permanently reserve every business key: rejected because ordinary product
  names and Resource URLs are not security identities.
- Use soft deletion for every table: rejected because many records are
  relationships or terminal security events rather than restorable resources.

## References

- [Resource lifecycle reference](../architecture/resource-lifecycle-reference.md)
- [Authorization schema](../../server/db/schema/authorization-tables.ts)
- [Agent identity schema](../../server/db/schema/agent-identity-tables.ts)
- [Management API specification](../../specs/management-api.feature)
- [Agent identity specification](../../specs/agent-identity.feature)
