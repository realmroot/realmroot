# Better Auth 1.7.5 integration

Version checked against npm `latest` and the upstream release on 2026-09-22.
Core, OAuth Provider, Passkey and i18n are pinned together at 1.7.5.
Agent Auth has an independent release line; its latest remains 0.6.2.

Sources:
- https://github.com/better-auth/better-auth/releases/tag/v1.7.5
- https://better-auth.com/docs/guides/1-7-upgrade-guide

## Removed customizations

| Previous customization | Replacement |
| --- | --- |
| OAuth device-code token handler, discovery and grant schemas | `oauthDeviceAuthorization()` and the upstream shared token issuer |
| Device-code form-to-JSON request wrapper | Native JSON/form support, including repeated resource parameters |
| Refresh-token resource storage and original-resource binding | Native resource columns and grant validation |
| ID-token `referenceId` callback patch | `extensions.claims.idToken`, which receives the authorization reference |
| OAuth access-token `at+jwt` signing override | Upstream per-call protected header |
| JWT schema patches for `alg` and `crv` | Native JWT schema |
| OAuth Basic form decoding patch | Native OAuth client credential decoding |
| Explicit logout session-cookie deletion patch | Native logout/session lifecycle |
| Generic OAuth-specific account-link call | Standard social account linking |
| Experimental joins configuration | `advanced.database.joins` |
| OAuth warning-suppression configuration | Removed by upstream |

## Remaining patches

The core and OAuth Provider patch files shrink from 1,008 to 478 lines (including
diff context). The separate Agent Auth patch is unchanged.

The patch files intentionally preserve established Realmroot contracts:

- OAuth post-login Context selection remains request-bound, session-bound and
  atomically consumed. Selecting an Organization must not change global session
  state or leak across concurrent browser tabs. Upstream still exposes only a
  boolean redirect hook and a context-free consent-reference callback.
- Access tokens contain exactly one audience; the default is the userinfo
  endpoint for OpenID requests and the auth issuer otherwise. Upstream supports
  multiple audiences and automatically adds userinfo to resource tokens.
- Dynamic access scopes are intersected with current Realmroot permissions
  before signing and returning tokens. Refresh tokens preserve the complete
  granted scope set so another authorized resource can be selected later.
- Machine subjects are Realmroot Application IDs. Access tokens use `client_id`
  instead of `azp`; introspection also accepts older `azp` tokens.
- Reuse of a revoked refresh token is rejected without revoking unrelated
  logins for the same user/client. Refresh-response replay remains disabled.
- JWT server APIs retain explicit audience verification and the existing
  signing-header option used by Realmroot's Agent token issuer. Key selection
  creates a configured-algorithm key instead of falling back to another alg.
- Agent Auth retains atomic shared-D1 JTI consumption and replacement of pending
  approval requests. There is no newer Agent Auth release to replace these.

New upstream integration fix: OAuth resource seeding must inspect nested error
causes. Drizzle wraps the D1 duplicate-key error, so matching only the outer
message breaks upstream's existing concurrent-initialization handling.

## Schema and existing data

Apply `20260922163336_better_auth_1_7.sql` before starting the new code. It adds
OAuth resource/client-resource/client-assertion tables, token replay/claims/
resource fields, device OAuth fields and organization team fields.

The migration backfills machine-client resource scope allowlists from the
Realmroot Application catalog, native client application types, existing device
client bindings and team counts. Existing team/user uniqueness remains enforced;
BA fills the optional hashed membership key when it encounters a legacy row.
Account identities remain `(providerId, accountId)`; 1.7.5 does not require the
`issuer` column introduced and subsequently reverted in 1.7.0–1.7.2.

Token and introspection requests must use the registered client authentication
method. Realmroot confidential clients register `client_secret_basic`; send their
credentials in the Basic header, not the POST body.

Device resource indicators must be supplied at device-code issuance. A code
issued without a resource cannot acquire a new resource during token polling.
OAuth device codes cannot mint first-party browser sessions at `/device/token`.

The account-management unlink route keeps its provider-side selector contract
and resolves the authenticated user's local account ID before calling BA.
Generic OAuth callbacks already use `/api/auth/callback/:providerId` in Realmroot;
provider registrations should retain that canonical URL.

Microsoft changed its built-in account subject from `sub` to `oid`. Before an
authorized production rollout, inventory enabled Microsoft Connectors and migrate
any existing subjects using verified provider data as described upstream. No
production data was inspected or changed during this local upgrade.

## Local reviewer path

Use the standard local database migration and development commands. Bootstrap
an administrator, create a native Application with device login enabled, request
a device code, approve it in `/auth/device`, and redeem it at `/oauth2/token`.
Verify password sign-in, account linking/unlinking, MFA, and an OAuth consent
flow that selects an Organization Context. For a resource-enabled client, issue
a token, remove a permission, and verify refresh cannot restore that permission.

## Local validation

- Build, all TypeScript projects, architecture boundaries, migration journal,
  frozen lockfile installation and formatting of changed files pass.
- Specification validation covers 210 scenarios with bidirectional traceability.
- Full unit run: 964 passed; the three changed upstream expectations were
  corrected and their affected files rerun with all 17 tests passing.
- Full web run: 726 tests passed.
- Full D1 integration run: 150 passed; two requests used a client authentication
  method different from registration. After correcting those fixtures, the
  affected token, authorization and account suites pass all 30 tests, including
  concurrent initialization and legacy account-unlink coverage.
- An existing-data migration test passes against the complete migration history.
- Browser auth/routing and OAuth Context suites: nine passed initially; one
  login-setup timeout showed page reloads before a sign-in request was sent.
  The unchanged failed case passed when rerun alone (all ten journeys have
  passing evidence; the initial timeout is retained as a local flake).

Deployment is separate; no remote database migrations were applied.

## Initialization and verification performance (2026-09-22)

Production traces exposed 24 serial resource reads during provider initialization
(6.3 seconds from SIN to D1 EWR). Insert-only resource configuration now performs
no resource-table I/O at plugin initialization. Token authorization looks up only
the requested target and materializes its configured defaults if the row is absent.
Existing policies and disabled flags remain authoritative, unregistered targets
remain rejected, and concurrent inserts retain unique-conflict handling. Explicit
merge/overwrite seed modes retain upstream initialization semantics. No pending
request-owned initialization promise is shared across Worker invocations.

The Worker publishes only authentication instances whose `$context` has resolved.
Failed, abandoned, and timed-out initializers cannot enter the global cache.
Resource reconciliation, security-policy loading, configuration loading and
provider initialization each have a five-second deadline. This is a failure
boundary, not a performance target: timeout returns HTTP 503 without stale-policy
fallback or automatic retries. D1 queries cannot be cancelled; their late results
are not published into these caches. Business handlers are not raced against a
timeout, avoiding ambiguous results for committed mutations.

JWT verification treats key-store failures and corrupt stored keys as server
errors. Malformed tokens, unknown key IDs, signature failures and invalid claims
remain authentication failures. The core patch narrows the catch around token
verification; Resource API authentication no longer catches all errors as null.

`worker.request.complete` records preparation plus routing, including initialization
failures and health/cache responses. `Server-Timing: total;dur=...` reports the same
interval. Existing `request.complete` remains the narrower router measurement;
operators must use the Worker event or root trace for end-to-end latency.

Regression proof: `server/worker-performance.test.ts`,
`server/integration/auth-performance.test.ts`, and the machine-token journey in
`server/integration/token-claims.test.ts`. Deployment requires the patched lockfile
and normal backend, type, specification, and build checks, followed by live
protocol and authenticated boundary probes.

The cold/request-path audit also removes unnecessary CPU work: login configuration
selects authentication-enabled Connectors and decrypts only login client secrets;
resource and registration credentials remain owned by their respective operations.
Secret ciphers derive their AES key on first encryption/decryption, not construction.
Ready auth instances retain a router via a WeakMap, while dependency injection and
security state remain request-local. Router invalidation follows auth configuration
invalidation, so changed provider settings do not retain old handlers.

Management OpenAPI generation is also deferred to its first consumer and cached.
Importing the Worker no longer converts the complete Zod schema graph into an
OpenAPI document. Existing semantic-contract tests verify identical output.
