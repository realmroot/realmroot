# Unified site settings

Status: accepted; staged production rollout.

Site-wide configuration belongs to one `site_settings` table, with one JSON object per named group, a monotonically increasing revision, and an update timestamp. Runtime boundary schemas validate each group. Database conditional writes reject stale revisions. Public configuration is an explicit projection and never exposes secrets.

Groups: general, branding, sign_in, account_center, navigation, security, developer, email. Deployment bindings and origins remain runtime configuration. Application and organization state stays with its owner.

Existing management resource URIs and representations remain compatible. Navigation is a site-owned value object with an ordered, bounded list of external links. Its lifetime, authorization and concurrency boundary belong to the site's navigation configuration. The new canonical resource is `/api/realm/navigation`, with GET and conditional PUT, protected by existing `settings:read` and `settings:write` authority. No per-link CRUD endpoints or generic arbitrary-setting endpoint are introduced.

RESOURCE MODEL PASS. DOMAIN GROUP AND NAMESPACE PASS. FIELD VS RESOURCE PASS. NO-RPC PASS.

## Release sequence

1. Back up production configuration privately and record scope/cardinality and semantic values.
2. Expand schema and migrate existing configuration. Keep old tables during the first deployment. Forward old-table writes during the deployment overlap, so the old Worker cannot lose updates after backfill.
3. Switch all repositories and assets to named groups. Verify public and authenticated configuration, settings writes, authentication and uploaded branding.
4. Compare production migrated values against the captured baseline and account for intentional changes. Only then release contract migration removing old tables and temporary synchronization.

A first-release rollback must reconcile changes from the new groups back into the old tables before restoring old code. After old tables are removed, rollback requires verified restoration from the private backup or a prepared forward fix; code-only rollback is unsafe.

## Review acceptance

Use the preview deployment with a platform operator. Open Console account-center settings, add an external service through the dialog, save, then inspect desktop and mobile Account Center navigation. Edit, reorder and delete it; an empty list hides the whole external group. Verify branding uploads and settings persist, public configuration excludes secrets, and stale updates fail. Local regression includes real SQLite migration fixtures and real D1 repository/API tests.


The current Cloudflare main-branch trigger runs `pnpm run build` and `npx wrangler deploy`; it does not apply D1 migrations. The release operator must apply the expand migration with the Agent identity before merging. Contract migration is applied only after deployed group values and public behavior are verified. Both migrations are then recorded in the normal D1 history.

Validation before first rollout: 1,744 unit/Web/integration tests; Console CRUD and desktop/mobile navigation browser journeys; typecheck, lint, architecture lint, spec traceability, and production build. A private production snapshot was replayed through the migration successfully. No secrets or production configuration are committed.


## Verified contraction

The expansion release was merged as PR #240 and deployed by Cloudflare from `27bb36977b0c0ff6db6a5e9cba46db6439e7485a`. All five existing production groups matched the private migration baseline exactly. Public configuration retained every existing value. Authenticated management reads passed for Realm identity, sign-in policy, branding, account management and email delivery. The Wallet link was saved through the conditional navigation API; unsafe destination and stale-version requests were rejected without modifying it.

The contract migration removes the five superseded tables and temporary synchronization triggers. It refuses removal of a populated source when its migrated group is absent. Current group values and revisions are left intact. The migration suite proves preservation of settings edited after the expansion release, missing-group refusal, and a fresh installation. Historical ownership migration fixtures remain bounded to their own supported legacy schema.
