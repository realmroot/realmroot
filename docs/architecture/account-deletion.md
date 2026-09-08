# Permanent account deletion

Account deletion ends a User identity permanently. It is not suspension, a recovery period, or a scheduled future deletion. The `user` row remains as a historical tombstone; its profile and authentication data are erased. A new registration with the same email or username receives a new ID and no former authority.

## Entry points

- Account Center → Sign-in & security → Delete account.
- `DELETE /api/account`, JSON `{ "confirmation": "DELETE" }`. Requires a browser session created within five minutes, explicit confirmation, and no impersonation or delegated Application/Agent principal. Returns `202` with `{ "deleted": true, "cleanup": "pending" }` after the local transaction commits, and clears native session cookies so another account can sign in in the same browser.
- `DELETE /api/users/{id}` preserves its management authorization and `204` response, and uses the same deletion use case. Its existing self-target prohibition remains.

A sole Organization owner must transfer ownership or delete the Organization first. A database guard checks this within the same D1 batch as deletion; two concurrent owners cannot both remove themselves and leave an ownerless Organization. Shared Organizations, Applications, Resources, and grants to other principals are not deleted merely because the User created them.

## Local atomic boundary

The deletion repository performs a single D1 batch. It captures durable external cleanup work, removes credentials, sessions, memberships, personal profile and disposable pending flows, revokes personal Agent identities/bindings and affected resource grants/leases, clears personal connection labels and identity fields, scrubs relevant audit metadata and locally stored user/session webhook payloads, and writes the User tombstone last. A failure rolls back the whole operation.

User tombstones retain their ID and deletion time, with fixed presentation values, a random `.invalid` email placeholder, no username, and no profile or credentials. Agent issuer/subject, username and installation bindings remain reserved under ADR 0012; display names, runtime metadata, public keys and authority are cleared or revoked. These historical references are not represented as fully anonymous data.

Database triggers reject tombstone edits and new or updated authentication/identity rows referring to deleted Users. Active User reads exclude tombstones. Session reads validate the live database session while preserving existing cached organization-context behavior. Native hosted-auth routes reject deleted cached principals. OAuth userinfo, introspection and refresh cannot revive a deleted User. Signed email verification links include the immutable User subject so old links cannot act on a replacement account with the same email.

## External cleanup

`account_deletion_cleanup` contains only unfinished work. The existing Worker scheduled entry point polls every five minutes, claims at most ten jobs per invocation, and uses expiring claims with bounded exponential retry delays. Each outbound cleanup request has a 15-second timeout. A failed provider does not prevent independent file deletion or other revocations.

Provider and leased tokens are revoked locally in the atomic transaction. Encrypted token material is available only for pending upstream revocation; each successful revocation clears that material. R2 avatar metadata is removed immediately, and object keys remain in the cleanup job until object deletion succeeds. Avatar responses now use `no-store`. An avatar upload that loses a race with deletion is rejected and its stored object is deleted or durably queued for cleanup.

After cleanup, the worker publishes `user.deleted` with only the immutable User ID, using that ID as the stable webhook event ID across retries. Existing webhook delivery storage handles delivery failures. The cleanup row is then removed. Failures remain retryable and the scheduled invocation reports an error with its causes; upstream response bodies are not saved in cleanup metadata.

This deletes Realmroot data and revokes the grants it controls. It does not delete third-party provider accounts, downstream application data, independently retained legal records, or copies already downloaded by clients. External resource servers validating JWTs offline may accept previously issued JWTs until expiration; immediate revocation requires their live authorization/introspection support. Backups must retain their configured lifecycle and deletion decisions must be reapplied before a restored database serves traffic.

## Rollout and operations

Apply the new D1 migrations before deploying this code and include both configured Cron triggers. No new service, queue binding, secret, or dependency is required. Previously issued email verification links without an immutable subject become invalid; users can request a new verification email.

Monitor failed scheduled invocations and `account_deletion_cleanup` rows with increasing `attempts` or overdue `next_attempt_at`. Fix the failing provider/storage/configuration cause; the next scheduled invocation resumes cleanup. Never clear a job manually to disguise failure. Do not roll back to code that treats tombstones as active Users; restore a compatible build instead.

## Local acceptance

The integration suite exercises real D1 migrations and production routing: immutable tombstones, credentials and old sessions, new identity registration, last-owner conflicts and concurrency, admin deletion, durable retries, abandoned-claim recovery, avatar-upload races, real OAuth issuance followed by revocation, and old email-verification links after email reuse. Provider HTTP and storage failures are injected only at their gateway boundaries.

The browser journey creates a disposable non-owner user, opens deletion on mobile and desktop, cancels and checks keyboard focus, confirms deletion, checks the completion page, verifies protected pages require sign-in, and signs into another account without manually clearing cookies. It runs against the isolated local E2E database; never use this destructive test against production.

For manual review, use a migrated local or isolated review deployment and create a disposable, email-verified user that is not the sole owner of an Organization. Sign in, open `/security`, and select **Delete account**. Cancel once to verify focus returns to the trigger, then confirm deletion. The completion page must appear, `/api/account/profile` must return `401`, and another account must be able to sign in in the same browser. A session older than five minutes must instead show the reauthentication instruction; a sole Organization owner must receive the transfer/delete-Organization instruction without losing their account.

Acceptance recorded on 2026-09-08 on the PR branch based on `e7cf7e1d` (main):

- `pnpm test`: 227 files, 1,818 tests passed across unit, web, and real D1 integration projects.
- The full suite includes 11 real D1 account-deletion integration tests; `pnpm run typecheck` passed.
- `pnpm run test:e2e`: all 27 browser tests passed, including deletion followed by another sign-in in the same browser.
- `pnpm run spec:check`: all 209 scenarios traced bidirectionally.
- `pnpm run lint`, `pnpm run lint:arch`, `pnpm run build`, and `git diff --check` passed. `pnpm run db:generate` reports no schema changes.

These are local acceptance results. No production migration or deployment was performed.

Coverage follow-up on 2026-09-08: the initial CI failure was missing unit-layer proof for logic already exercised by D1/E2E tests. Added scheduler failure/completion, orphaned-upload cleanup, upstream revocation, and browser state tests without changing production behavior or coverage thresholds. Both CI coverage commands now pass locally: `pnpm run test:coverage:backend` (968 tests) and `pnpm run test:coverage:web` (725 tests). The deletion scheduler and deletion panel each have 100% statement, branch, function, and line coverage.
