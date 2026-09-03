# Architecture Decision Records

This directory records consequential Realmroot architecture decisions: choices
that are hard to reverse, cross a security or deployment boundary, or explain a
non-obvious trade-off. `docs/architecture/` describes the current system;
ADRs preserve why it became that system.

`Accepted` means the decision is implemented, not merely intended. The initial
records 0002–0013 were audited from source baseline `c061f048` against
production code, schemas, runtime configuration, and executable specifications;
factual corrections found by that audit are included with the records. Their
References point to the current evidence. OpenAPI and `specs/*.feature`, not ADR
prose, remain authoritative for endpoint and product behavior details.

## Lifecycle

- `Proposed`: under review and not yet authoritative.
- `Accepted`: the current decision.
- `Superseded`: replaced by a later ADR, which both records link to.
- `Deprecated`: retained for history but no longer recommended.

Accepted ADRs are immutable except for factual corrections, typo fixes, and
additional evidence links. Change a decision by adding a new ADR and marking
the old one superseded. Name records `NNNN-short-decision-title.md` and use the
next available number. Do not copy an ADR's rationale into a mutable architecture
reference; that reference should describe only the current implementation.

## Index

- [0001 — Record consequential architecture decisions](0001-record-consequential-architecture-decisions.md)
- [0002 — Treat one deployment as one Realm](0002-one-deployment-is-one-realm.md)
- [0003 — Enforce inward dependency direction](0003-clean-architecture-dependency-direction.md)
- [0004 — Keep provider compatibility in external Adapters](0004-provider-compatibility-through-external-adapters.md)
- [0005 — Keep OAuth tokens outside browser JavaScript](0005-browser-session-and-token-boundary.md)
- [0006 — Use stable Agent identity with delegated authorization](0006-stable-agent-identity-and-delegated-authorization.md)
- [0007 — Publish one resource API for Toolbox clients](0007-unified-resource-api-and-toolbox.md)
- [0008 — Specify behavior in Gherkin with layered proof](0008-behaviour-first-specification-and-layered-proof.md)
- [0009 — Deploy on Cloudflare Workers with D1](0009-cloudflare-workers-and-d1-runtime.md)
- [0010 — Let Resource Servers own business authorization](0010-resource-server-owns-business-authorization.md)
- [0011 — Use UUIDv7 for persistent identifiers](0011-use-uuidv7-for-persistent-identifiers.md)
- [0012 — Preserve history with explicit lifecycle semantics](0012-preserve-history-with-explicit-lifecycle-semantics.md)
- [0013 — Separate User, Organization, and Realm management](0013-separate-user-organization-and-realm-management.md)

## Template

```markdown
# NNNN — Decision title

- Status: Proposed
- Date: YYYY-MM-DD
- Deciders: Realmroot maintainers

## Context

What forces a decision, including the relevant constraints.

## Decision

The chosen architecture and its boundary.

## Consequences

What becomes easier, harder, required, or intentionally unsupported.

## Alternatives considered

The credible alternatives and why they were not selected.

## References

Links to current architecture, contracts, or specifications.
```
