# 0001 — Record consequential architecture decisions

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

Realmroot already has detailed architecture documents, but those documents
describe the current model rather than the decision history. Security,
tenancy, identity, API, and deployment choices need a durable explanation of
their trade-offs so later changes do not accidentally reverse an invariant.

## Decision

Use numbered ADRs for consequential, hard-to-reverse, or non-obvious choices.
Keep current-state explanations in `docs/architecture/`. Accepted ADRs remain
historical records; a later decision supersedes rather than rewrites them.

## Consequences

- Reviewers can distinguish an invariant from an incidental implementation.
- Architecture changes must name affected ADRs and add a superseding record.
- Routine implementation details and reversible local choices do not receive
  ADRs.

## Alternatives considered

- Architecture documents only: rejected because they erase decision history.
- Decision notes in issues or pull requests only: rejected because they are not
  discoverable beside the maintained architecture.

## References

- [Realmroot technical documentation](../README.md)
