/**
 * Architecture enforcement for the hono-cf-clean-arch layout.
 *
 *   pnpm lint:arch  ->  depcruise server/ shared/ --config .dependency-cruiser.cjs
 *   (keep the trailing slashes — bare directory names can resolve to 0 modules)
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-stays-pure',
      comment: 'domain/ may only import domain/ and shared/. No frameworks, no I/O.',
      severity: 'error',
      from: { path: '^server/domain' },
      to: { pathNot: '^server/domain|^shared' },
    },
    {
      name: 'usecases-no-infrastructure',
      comment: 'usecases/ must not reach outward to adapters, http, db, or composition.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: '^server/(adapters|http|db)|^server/composition' },
    },
    {
      name: 'usecases-no-framework-packages',
      comment: 'usecases/ must not import delivery or persistence frameworks.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: 'node_modules/(hono|drizzle-orm|zod|better-auth|@better-auth)' },
    },
    {
      name: 'adapters-not-into-delivery',
      comment: 'adapters/ implement ports; they never know about http/ or composition.',
      severity: 'error',
      from: { path: '^server/adapters' },
      to: { path: '^server/(http|composition)' },
    },
    {
      name: 'drizzle-only-in-repos',
      // better-auth owns its own tables AND is consumed by the delivery layer, so it
      // stays at server/auth*.ts with this named exception (moving it into adapters/
      // would only trade this for an http-into-adapters violation).
      comment: 'Persistence is confined to adapters/repos/, db/, and the better-auth boundary.',
      severity: 'error',
      from: { path: '^server', pathNot: '^server/(adapters/repos|db|auth)' },
      to: { path: 'node_modules/drizzle-orm|^server/db/schema' },
    },
    {
      name: 'http-not-into-adapters',
      comment: 'http/ gets dependencies from context, never constructs adapters.',
      severity: 'error',
      from: { path: '^server/http' },
      to: { path: '^server/adapters' },
    },
    {
      name: 'shared-is-a-leaf',
      comment: 'shared/ is the contract; it imports nothing from server/ or src/.',
      severity: 'error',
      from: { path: '^shared' },
      to: { path: '^server|^src' },
    },
    {
      name: 'frontend-not-into-server',
      comment:
        'The SPA talks to the server over HTTP only. The single exception is the hono RPC ' +
        'client (src/lib/api), which imports the AppType contract from server/http/app.',
      severity: 'error',
      from: { path: '^src' },
      to: { path: '^server', pathNot: '^server/http/app\\.ts$' },
    },
    {
      name: 'server-not-into-frontend',
      comment: 'The server never reaches into the SPA; the two halves meet only through shared/.',
      severity: 'error',
      from: { path: '^server' },
      to: { path: '^src' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // `server/integration/` is the test crown — its harness wires real adapters,
    // schema, and migrations on purpose (nothing is faked there), so it sits
    // outside the production dependency rules, like the `.test.ts` files it serves.
    exclude: {
      path: [
        '\\.(test|spec)\\.[jt]sx?$',
        '\\.gen\\.[jt]s$',
        '\\.d\\.ts$',
        '^server/integration/',
        // Co-located test-support files live beside source but are not production
        // code; they are excluded from the architecture cruise like the tests they serve.
        'test-deps\\.ts$',
        '\\.test-utils\\.[jt]sx?$',
        '\\.test-fixtures\\.ts$',
        '\\.settings-fixtures\\.ts$',
      ],
    },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
}
