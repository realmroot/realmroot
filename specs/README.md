# FlareAuth Specs

Specs are the product-facing source of truth for FlareAuth behavior. They
describe the feature, scenario, and verification path. They are **Gherkin
documentation, not an executable suite** — there is no Cucumber runner. Tests
reference specs; the specs do not generate tests.

## Format

- One `.feature` file per product area.
- Each scenario carries a stable `@journey:<id>` tag (the id never changes once
  written) and exactly one `@entrypoint:<id>` tag (`product-ui` or `restish`).
- Add `@e2e` only to scenarios proven by the hermetic Playwright crown in
  `../tests/e2e`. Most behaviour is proven cheaper (usecase/web/integration) and
  carries no `@e2e` tag.
- Keep scenario steps user-facing. Implementation details belong in tests.

## Traceability

Every scenario maps to its home test by a `[spec: <feature>/<journey>]`
breadcrumb in the test title (e.g. `[spec: platform-onboarding/first-admin-gate]`).
The breadcrumb sits on the test that genuinely asserts the scenario's behaviour,
at the cheapest meaningful layer (usecase, web, route, then the real-D1
integration crown, with Playwright only for hermetic cross-stack journeys).
`pnpm run spec:check` is a runner-less governance lint (sibling to `lint:arch`)
that verifies:

1. Every scenario declares `@journey:<id>` and exactly one supported
   `@entrypoint:<id>`.
2. Every scenario has its matching `[spec:]` breadcrumb somewhere in the test
   tree (`server/`, `src/`, `shared/`, `tests/`).

The breadcrumb scan covers all co-located suites, so a behaviour proven by a
usecase or web test is traced there — `@e2e` only marks the hermetic Playwright
crown; it never relaxes the tracing requirement.

When adding a product behaviour, update the source spec first, assign the
journey and entrypoint, then cover it at the cheapest meaningful layer and add
the `[spec:]` breadcrumb to that home test (adding a Playwright spec and the
`@e2e` tag only when the behaviour is a genuinely cross-stack, hermetic journey).
