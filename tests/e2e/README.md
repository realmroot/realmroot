# Playwright E2E

The product behaviour is described behaviour-first in `../../specs/*.feature`
(Gherkin docs, no runner). This directory holds the hermetic Playwright crown:
the journeys that genuinely need the whole stack — real SPA + Worker + isolated
local D1 + Better Auth — with NO external dependency.

## Layout

- `*.spec.ts`: Playwright `test()` specs. Each test that covers an `@e2e`
  scenario carries a `[spec: <feature>/<journey>]` breadcrumb in its title; the
  `spec:check` governance lint enforces that traceability.
- `helpers/real-app.ts`: admin fixture, isolated-D1 reset/migrate, admin
  bootstrap, and sign-in/out helpers.
- `helpers/http.ts`: a small retrying fetch used during bootstrap.
- `global-setup.ts`: resets + migrates the isolated D1 once before the suite.
- `wrangler.toml`: the isolated E2E Worker/D1 config used by `vite dev --mode
  e2e` (separate state from `pnpm dev`).

## Running

`pnpm run e2e` boots `vite dev --mode e2e` against the isolated D1
(`CF_PERSIST_STATE_PATH`), waits on `/api/health`, then runs the serial chromium
suite. The suite is stateful (it drives onboarding), so it never runs in
parallel and each spec re-seeds its own starting state.

## Scope discipline

Keep this to a handful of journeys. Flows that depend on a third party (external
IdP, email delivery, SMS) do NOT belong here — verify those at the cheaper
layers (usecase/web/integration) or manually. Flaky e2e nobody trusts is worse
than none.
