# Clean Architecture (hono-cf-clean-arch)

The `server/` half follows the four-layer clean-architecture layout. Source-code
dependencies point inward only; the rule is enforced by `dependency-cruiser`
(`pnpm run lint:arch`), wired into the pre-commit hook and CI — not just prose.

## Layout

```
server/
  domain/          # Pure business rules. Plain TS; imports only domain/ + shared/.
                   #   errors, password, security/policy, connectors/provider-templates,
                   #   agents/capabilities
  usecases/        # Application operations (service classes) over ports.
    ports.ts       # Interfaces + plain record types for everything past the process
                   #   boundary (repositories, gateways). No drizzle, no zod, no hono.
    deps.ts        # The Deps aggregate of all ports.
    <resource>.ts  # One usecase module per resource (+ <resource>-utils.ts helpers).
  adapters/
    repos/         # Drizzle repositories — the ONLY place the db schema is imported.
    gateways/      # External services: email sender, JWKS fetch.
  http/            # Hono routes (by resource), zod validation, error mapping, auth
                   #   middleware, the app assembler, and the RPC schema/AppType.
  composition.ts   # createDeps(env, config) (request-free root) + the request-bound
                   #   service factories. The only place adapters are constructed.
  worker.ts        # fetch entrypoint: validateEnv -> createDeps -> createApp.
  auth*.ts         # better-auth integration (owns its own tables + serves requests).
  db/              # drizzle schema + client factory (consumed by adapters/repos only).
shared/            # API contract: DTO types + pure helpers used by both halves.
src/               # React SPA (not governed by the layers).
```

## The dependency rule (enforced)

`http -> usecases -> domain`; `adapters -> usecases(ports) + domain`;
`composition -> everything`. Never the reverse. The exact rules live in
`.dependency-cruiser.cjs`:

- `domain/` imports only `domain/` and `shared/` (no frameworks, no I/O).
- `usecases/` never imports `hono`, `drizzle-orm`, `zod`, `better-auth`, or anything
  in `adapters/`, `http/`, `db/`, or `composition`.
- Drizzle schema is confined to `adapters/repos/` and `db/` — plus `server/auth*.ts`
  (the better-auth boundary owns its own tables; this is a named exception).
- `http/` never constructs adapters; it gets capabilities from `composition`.
- `shared/` is a leaf; the two halves meet only through `shared/`.

## Path aliases

`@/* -> src/*`, `@server/* -> server/*`, `@shared/* -> shared/*`, defined identically
in `tsconfig.json` `paths` and `vite.config.ts` `resolve.alias` (vitest reuses the
vite config). Cross-directory server imports use `@server/*`; same-directory siblings
stay relative.

## Testing

The layers are the test taxonomy (`tests/`): `unit` (domain/usecases/adapters over
fakes), `contract` (shared DTO schemas), `component` (SPA with the API mocked), and
`integration` (`app.fetch` flows with in-memory repositories). Cucumber `e2e` covers
hermetic cross-stack journeys; see `specs/` and `pnpm run spec:check`.

## Deliberate adaptations from the skill

These depart from the greenfield skill on purpose, to respect existing project
conventions and keep the migration behavior-preserving:

- **Service classes** (constructor-injected ports) are kept rather than rewritten to
  free functions — they remain testable with fake ports, which is the actual goal.
- **Options/factory DI** through `createApp` is retained (alongside `createDeps`) so
  the existing test suite stays valid; the per-request service factories are
  consolidated in `composition.ts`.
- **Test strategy** keeps the project's in-memory-repository suites under `tests/`
  (single vitest project) and the **specs/ + Cucumber** workflow mandated by the repo,
  rather than the skill's workerd+real-D1 split and BDD-lite `spec/` convention.
- **Env** stays hand-written (`shared/env.ts` + `validateEnv`) rather than `cf-typegen`.
