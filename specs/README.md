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

Each `@e2e` scenario maps to a test by a `[spec: <feature>/<journey>]`
breadcrumb in the test title (e.g. `[spec: platform-onboarding/first-admin-gate]`).
`pnpm run spec:check` is a runner-less governance lint (sibling to `lint:arch`)
that verifies:

1. Every scenario declares `@journey:<id>` and exactly one supported
   `@entrypoint:<id>`.
2. Every `@e2e` scenario has its matching `[spec:]` breadcrumb in `tests/`.

When adding a product behaviour, update the source spec first, assign the
journey and entrypoint, then cover it at the cheapest meaningful layer — adding
a Playwright spec (and the `@e2e` tag + breadcrumb) only when the behaviour is a
genuinely cross-stack, hermetic journey.
