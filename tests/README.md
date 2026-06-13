# Test Layout

The architecture layers are the test taxonomy. Vitest owns code-level
verification and coverage; Playwright owns the hermetic end-to-end crown. The
behaviour-first source of truth is `../specs/*.feature` (Gherkin docs, no
runner) — tests reference scenarios via `[spec: <feature>/<journey>]`
breadcrumbs.

Vitest tests are co-located beside the source they cover (`server/**/*.test.ts`,
`shared/**/*.test.ts`, `src/**/*.test.{ts,tsx}`); only the Playwright crown lives
under this directory (`e2e/`).

## Vitest

- `unit` (`server/**` + `shared/**`, excluding `server/integration/`): server
  domain/usecases/adapters over fake ports, shared contracts, and faked server
  flows. **Coverage is collected here**, and this is where business branches are
  exhausted.
- `web` (`src/**`): React component and routed-page tests, the browser auth
  client, and shared/API client contract tests. Mocked API responses are allowed
  here (MSW / fetch spies), but these tests are not E2E.
- `integration`: the real-D1 crown (`server/integration/`) — full `app.fetch`
  flows in workerd. Per resource: happy path + 401 + 403 + one validation
  failure, not the usecase branch matrix.

Do not put browser journey specs in the Vitest suites. If a behaviour is a
genuinely cross-stack, hermetic journey, document it in `../specs` and cover it
with Playwright in `e2e`.

## Playwright E2E

- A handful of hermetic journeys only: real SPA + Worker + isolated local D1 +
  auth, with NO external dependency (onboarding, auth/session/cookies, routing,
  admin config CRUD that only writes D1).
- Specs live in `e2e/*.spec.ts`; shared helpers in `e2e/helpers`.
- The isolated D1 (`e2e/wrangler.toml` + `CF_PERSIST_STATE_PATH`) is reset and
  migrated by `e2e/global-setup.ts` before the serial suite; specs seed their own
  starting state.
- Run with `pnpm run e2e`. It is a separate CI job from `pnpm test`.
