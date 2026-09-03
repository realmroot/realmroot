# 0003 — Enforce inward dependency direction

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

Realmroot combines HTTP/OAuth transport, authorization policy, external
providers, Cloudflare runtime services, and durable storage. Allowing framework,
ORM, or provider details into policy code makes security behavior difficult to
test and replacement decisions expensive.

## Decision

Domain and use cases own policy. Inward-owned ports describe database,
cryptography, time, identifiers, and external HTTP capabilities. Adapters
implement those ports; HTTP modules translate protocols; the composition root
constructs the concrete graph. Better Auth is a named integration boundary that
constructs the repositories required by its plugin callbacks because those
callbacks are owned by Better Auth rather than the Resource API composition
root. Layers are added only where they own real behavior or a system boundary.

## Consequences

- Business decisions can be exhaustively tested with explicit fakes.
- Real D1, router, middleware, and external-protocol semantics remain the
  responsibility of integration tests.
- Runtime service lookup, ORM rows in use cases, and pass-through ceremonial
  layers are prohibited. Use cases currently receive the explicit inward-owned
  `Deps` port bundle used by the composition root.
- The dependency rules and the Better Auth exception are enforced by the
  repository import graph rather than by documentation alone.

## Alternatives considered

- Route-centric application logic: rejected because transport and policy
  evolve for different reasons.
- Table-oriented repositories exposed to callers: rejected because storage
  shape would become the domain contract.

## References

- [Clean architecture](../architecture/clean-architecture.md)
- [Dependency rules](../../.dependency-cruiser.cjs)
- [Resource API composition root](../../server/composition.ts)
- [Better Auth boundary](../../server/auth.ts)
