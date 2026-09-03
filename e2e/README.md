# Playwright E2E and production verification

The product behaviour is described behaviour-first in `../specs/*.feature`
(Gherkin docs, no runner). This directory holds the hermetic Playwright crown:
the journeys that genuinely need the whole stack — real SPA + Worker + isolated
local D1 + Better Auth — with NO external dependency.

## Layout

- `*.spec.ts`: Playwright `test()` specs. Each test that covers an `@e2e`
  scenario carries a `[spec: <feature>/<journey>]` breadcrumb in its title; the
  `spec:check` governance lint enforces that traceability.
- `fixtures.ts`: environment-aware account fixture shared by local E2E and PVT.
- `helpers/real-app.ts`: local admin setup, isolated-D1 reset/migrate, and
  shared sign-in/out actions.
- `helpers/http.ts`: a small retrying fetch used during bootstrap.
- `global-teardown.ts`: removes runner-owned temporary state after local E2E.
- `wrangler.toml`: the isolated E2E Worker/D1 config used by `vite dev --mode
  e2e` (separate state from `pnpm dev`).

## Running

`pnpm run e2e` creates a unique temporary Cloudflare state directory, boots
`vite dev --mode e2e` against its isolated D1, waits on `/api/health`, then runs
the serial chromium suite. Fixtures seed the state required by each test and the
runner removes its temporary state at the end. CI shards files across two
independent runners, each with its own Worker processes and D1 state; tests
within one shard remain serial so they never mutate the same D1 concurrently.

`pnpm run pvt` runs the same tests tagged `@production-safe` against an existing
remote deployment. It never starts a local server, resets D1, bootstraps an
administrator, or runs the local-only write journeys. PVT opens Chrome once so
the operator can complete the deployment's real CAPTCHA; it then reuses that
short-lived session for the authenticated scenarios and revokes it on exit.
Provide the deployment origin and a dedicated smoke account explicitly:

```bash
PVT_BASE_URL=https://auth.example.com \
PVT_USERNAME=realmroot-smoke \
PVT_PASSWORD='...' \
PVT_EXPECTED_VERSION=2026-08-09 \
pnpm run pvt
```

The runner also loads these variables from the git-ignored `.dev.vars` file when
it exists, so a configured workstation can run `pnpm run pvt` directly. Explicit
environment variables take precedence. `PVT_BASE_URL` must be a remote HTTPS
origin. `PVT_EXPECTED_VERSION` is the API contract version expected after the
deployment and is compared with the published OpenAPI document. The account
must already exist; PVT creates and revokes only its own login session, then
proves that the revoked session can no longer access the Account API.
Production verification disables Playwright traces and screenshots so
credentials cannot enter failure artifacts.

PVT launches the installed Google Chrome directly and connects through its local
debugging protocol so production bot protection sees a normal browser rather
than a Playwright-launched one. Set `PVT_CHROME_EXECUTABLE` only when Chrome is
installed at a non-standard path.

## Scope discipline

Keep this to a handful of journeys. Flows that depend on a third party (external
IdP, email delivery, SMS) do NOT belong here — verify those at the cheaper
layers (usecase/web/integration) or manually. Flaky e2e nobody trusts is worse
than none.

Only tag a test `@production-safe` when it uses no local-D1 helper and creates
no production business or configuration resource. Environment setup belongs in
fixtures; do not duplicate a journey in a PVT-specific spec.
