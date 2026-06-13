# Repository Instructions

## Project

FlareAuth is a TypeScript auth service for Cloudflare Workers. It uses Hono,
Better Auth, Drizzle, React, Vite, Vitest, Biome, Wrangler, and Cloudflare D1.

## Development

- Use Node 24 and npm.
- Match the existing TypeScript, Hono, React, Drizzle, and Vitest patterns.
- Keep backend API contracts explicit and shared types centralized.
- For REST endpoints, use resource nouns, correct HTTP methods, correct status
  codes, consistent errors, pagination for collections, and idempotency where
  required.
- Do not add fallback or defensive logic inside trusted internal paths. Validate
  at user input, external API, network, database, and environment boundaries.
- Keep errors surfaced through the existing boundary handling instead of adding
  scattered try/catch blocks.

## Workflow: Behaviour-first specs

`specs/*.feature` are behaviour-first **documentation** (Gherkin, no runner).
They describe what the product does; tests reference them via
`[spec: <feature>/<journey>]` breadcrumbs. Tests follow the layered taxonomy —
the architecture layers are the test taxonomy:

- **unit** (node, fake ports): server domain/usecases/adapters + shared. This is
  where business-logic branches are exhausted; coverage is collected here.
- **web** (jsdom, MSW): the React SPA — components, hooks, the api client.
- **integration** (workerd + real D1): the crown in `server/integration/` —
  full `app.fetch` flows; per resource happy path + 401 + 403 + one validation
  failure, not the usecase branch matrix.
- **e2e** (Playwright, real stack): a handful of hermetic cross-stack journeys
  only (onboarding, auth/session/cookies, routing, admin config CRUD that only
  writes D1). No external dependency. A separate CI job from `pnpm test`.

For new or changed product behavior:

1. Update or add the relevant `.feature` scenario first.
2. Add `@journey:<id>` and exactly one `@entrypoint:<id>` to the scenario.
3. Cover it at the cheapest meaningful layer. Carry a `[spec: <feature>/<journey>]`
   breadcrumb in the home test's name.
4. Add `@e2e` and a Playwright spec only when the behaviour is a genuinely
   cross-stack, hermetic journey.
5. Run `pnpm run spec:check` (governance lint: every scenario tagged, every
   `@e2e` scenario traced to a breadcrumb).

Commands: `pnpm test`, `pnpm run test:coverage`, `pnpm run spec:check`,
`pnpm run e2e`.

If implementation reveals a new user-facing behavior, update the spec before
continuing.

Spec index:

- `specs/platform-onboarding.feature`: fresh deployment, first admin bootstrap,
  route access, and health smoke.
- `specs/hosted-auth.feature`: hosted sign-in, sign-up, recovery, OIDC context,
  consent, and callback behavior.
- `specs/account-center.feature`: profile, credentials, MFA, passkeys, sessions,
  linked accounts, and authorized apps.
- `specs/connectors-and-methods.feature`: connector-driven hosted method
  availability and native endpoint enforcement.
- `specs/admin-console.feature`: Console applications, users, connectors,
  security, authorization, branding, content, and deployment settings.
- `specs/management-api.feature`: Management API discovery and Restish
  command-line administration entry point.

## Checks

Use the narrowest meaningful command for the change:

- Typecheck: `pnpm run typecheck`
- Spec coverage: `pnpm run spec:check`
- Tests: `pnpm test`
- Lint: `pnpm run lint`
- Format/fix: `pnpm run lint:fix`
- Build: `pnpm run build`

The project has a Husky pre-commit hook at `.husky/pre-commit` that runs:

```bash
pnpm run typecheck && pnpm exec lint-staged
```

Do not rely on CI for checks that can be run locally before commit.

## Architecture And Review

For user-facing work, describe the review-environment acceptance path in the PR:
how the reviewer reaches the environment, required setup or seed data, and the
exact product journey to verify.

Automated E2E tests and Leader review-environment acceptance are separate
feedback paths. Add automated E2E only when it is the right project-level check;
always make the Leader acceptance path clear for product changes.
