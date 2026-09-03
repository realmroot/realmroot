# 0009 — Deploy on Cloudflare Workers with D1

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

Realmroot needs a globally reachable identity and authorization service with a
small operational footprint, durable relational constraints, uploaded assets,
and reproducible independent deployments.

## Decision

Deploy the HTTP application on Cloudflare Workers, use D1 for relational state,
and use R2 for uploaded assets. The committed Wrangler configuration is the
canonical deployment model for the upstream deployment and the template for
fork deployments. A fork generates an ignored deployment-specific Wrangler
configuration. Committed D1 migrations run before the compatible Worker is
published; a failed migration stops deployment.

## Consequences

- Worker runtime limits, D1 transaction semantics, bindings, and migration order
  are architecture constraints rather than local implementation details.
- Independently generated fork deployments use resource sets isolated from the
  canonical deployment.
- Real workerd/D1 integration tests are required where behavior depends on edge
  runtime or SQLite semantics.
- Moving to another runtime or datastore requires a superseding ADR and an
  explicit data migration strategy.

## Alternatives considered

- A long-running Node server with a separately operated database: rejected for
  the current product because it adds deployment and lifecycle infrastructure
  without a demonstrated requirement.
- KV-only persistence: rejected because identity and authorization invariants
  require relational constraints and atomic writes.

## References

- [Cloudflare deployment](../deploy/cloudflare.md)
- [Deployment upgrades](../deploy/upgrades.md)
- [`wrangler.toml`](../../wrangler.toml)
- [Worker entry point](../../server/worker.ts)
