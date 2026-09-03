# 0002 — Treat one deployment as one Realm

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

The issuer, user pool, signing keys, security policy, and operational resources
form one trust boundary. Modeling multiple independent Realms inside one
database would require every identity and security query to carry another
isolation key and would make a missed predicate a cross-Realm data leak.

## Decision

One Realmroot deployment is one Realm with one issuer and user pool. A Realm
may contain many Organizations and Applications. Products that need independent
identity roots use separate deployments and Cloudflare resource sets. The
deployment, rather than an Application or Organization row, owns login methods,
security policy, connector configuration, signing keys, and the administrator
population.

## Consequences

- Tenant isolation inside a Realm is expressed through User and Organization
  ownership, not a second deployment-tenant column.
- Environments that must not share identity state use separate deployments and
  Cloudflare resources.
- Cross-Realm administration and identity sharing are intentionally outside
  the core data model.

## Alternatives considered

- Multi-Realm rows in one deployment: rejected because it expands every storage
  and authorization boundary.
- One deployment per Organization: rejected because Organizations are a normal
  collaboration boundary within one Realm, not separate identity providers.

## References

- [`wrangler.toml`](../../wrangler.toml)
- [Cloudflare deployment](../deploy/cloudflare.md)
- [Hosted authentication specification](../../specs/hosted-auth.feature)
