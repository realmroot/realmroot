# 0008 — Specify behavior in Gherkin with layered proof

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

Line coverage cannot show whether product behavior is intentional, and a large
browser suite would make feedback slow and fragile. Realmroot needs a readable
source of product truth plus executable evidence at the cheapest boundary that
can prove each behavior.

## Decision

Keep user-visible behavior in runner-less `specs/*.feature` files. Every
scenario has one stable `@journey`, one `@entrypoint`, and one canonical
`@proof` layer. A test at that layer carries the matching `[spec:]` breadcrumb.
Unit tests own decision matrices, workerd/D1 integration tests own real service
boundaries, and Playwright owns only critical hermetic cross-stack journeys.

## Consequences

- Spec and test references are validated in both directions; stale scenarios
  and orphan proofs fail the repository gate.
- A feature describes observable behavior, not routes, tables, mocks, or test
  mechanics.
- Higher layers may add representative confidence without replacing the
  canonical cheapest proof.

## Alternatives considered

- Executable Cucumber as the primary runner: rejected because it would duplicate
  the established Vitest and Playwright harnesses without adding product value.
- Tests without a behavior source: rejected because intent would remain implicit.
- E2E for every scenario: rejected because it repeats decision matrices at the
  slowest and least diagnostic layer.

## References

- [Specification coverage](../../specs/README.md)
- [Repository testing conventions](../../AGENTS.md)
