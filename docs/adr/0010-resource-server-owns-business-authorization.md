# 0010 — Let Resource Servers own business authorization

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

Realmroot issues or coordinates tokens for APIs whose object model and business
rules it does not own. A Realmroot-maintained copy of each API's permissions
would drift from the protected API and could incorrectly treat a valid token as
a complete allow decision.

## Decision

The Resource Server owns its scope vocabulary, operation-to-scope mapping, and
final request authorization. It publishes requestable scopes through RFC 9728
metadata and may publish operation mappings and descriptions through OpenAPI.

Realmroot synchronizes that declared vocabulary, records tenant-bound roles,
consent, Agent Permissions, and revocation state, and issues only currently
authorized scopes. Realmroot does not decide object-, state-, ownership-, or
attribute-level access for another Resource Server. A valid token is an input
to the Resource Server's decision, not the decision itself.

## Consequences

- Scope names cannot be invented or edited independently in Realmroot.
- Resource metadata, OpenAPI security requirements, and Resource Server code
  must evolve together.
- Native and external Resources share the same responsibility split; only the
  final token issuer differs.
- Roles apply to human Organization memberships. Agents, Applications, and
  workloads receive exact tenant-bound scopes through grants, consent, or token
  exchange.
- A Resource Server must validate the token, validate DPoP when required by the
  token profile (including Agent tokens), and then enforce its own local policy.

## Alternatives considered

- Central business permission catalog in Realmroot: rejected because it would
  duplicate every protected API's policy.
- Treat token issuance as the final allow decision: rejected because a scope
  cannot express every resource-local invariant.

## References

- [Resource Server integration](../integrations/resource-servers.md)
- [Resource API](../api/resource-api.md)
- [Authorization context](../../server/domain/authorization-context.ts)
- [Authorization use cases](../../server/usecases/authorization.ts)
- [Agent identity specification](../../specs/agent-identity.feature)
