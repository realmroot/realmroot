# 0006 — Use stable Agent identity with delegated authorization

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

An Agent may run on several hosts, rotate credentials, and call several private
Resources. Conflating the Agent, its installation credential, its controller,
and its current Resource authority would make rotation revoke identity and
would obscure who delegated an action.

## Decision

Give each Agent one stable issuer and subject. Treat host installations as
revocable credentials bound to that identity. Model Resource authority as
explicit, scoped Permissions. A native Agent Resource token identifies the
Agent's personal-owner User or Organization home space in `sub` and the stable
Agent in the RFC 8693 `act` claim. An external Resource token uses the connected
target subject in `sub`. Delegated token exchange must preserve the Agent actor
chain and re-evaluate current policy.

## Consequences

- Credential rotation and host revocation do not change Agent identity.
- The Agent cannot inherit arbitrary controller authority; every Resource and
  scope is explicit and auditable.
- Applications may act for a User and create an Agent only through explicit
  Application authority and idempotent operations.
- Agent deletion reserves the historical subject and identifiers.

## Alternatives considered

- Use each host credential as the Agent identity: rejected because identity
  would change during recovery.
- Put the Agent in `sub`: rejected because downstream systems would lose the
  accountable controller User.
- Store Agent roles in tokens: rejected in favor of Resource-specific scope
  evaluation and current Permissions.

## References

- [Agent identity](../architecture/agent-identity.md)
- [Agent identity specification](../../specs/agent-identity.feature)
- [Agent identity schema](../../server/db/schema/agent-identity-tables.ts)
- [Token exchange](../../server/usecases/token-exchange.ts)
