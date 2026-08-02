# Cloudflare Deployment

Realmroot runs as a Cloudflare Worker with Assets, D1, R2, Email Routing, and
Cron bindings.

## Repository Model

Keep two clear repository roles:

- `saltbo/realmroot` is the canonical upstream source. Its own Worker deploys
  through Cloudflare Workers Builds or the equivalent local `pnpm run deploy`
  command and has no GitHub deployment workflow.
- A GitHub fork is one product deployment. Its only operational responsibility
  is holding GitHub Actions credentials and deploying its current `main`
  commit with the upstream-maintained deployment script.

The canonical deployment uses the committed `wrangler.toml`. A fork uses that
file only as a template and generates an ignored `wrangler.deployment.toml`
whose Worker, D1, R2, and secrets belong to that fork. The build
and deploy steps use the same selected configuration in both repository roles.

Do not develop product code in the deployment fork during normal operation.
Use GitHub's **Sync fork** action to bring upstream changes into the fork. The
workflow checks out the triggering fork commit, so the fork's `main` branch is
the explicit deployment version boundary.

## Create A Deployment

1. Fork `saltbo/realmroot`.
2. Copy [`deploy/realmroot-fork.yml`](../../deploy/realmroot-fork.yml) to
   `.github/workflows/deploy.yml` in the fork, then enable it from the fork's
   **Actions** tab. This small trigger belongs only to the deployment fork.
3. Add these repository secrets under **Settings > Secrets and variables >
   Actions**:

   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - optional `BETTER_AUTH_SECRET`
   - optional `CREDENTIAL_ENCRYPTION_KEY`

4. Optionally add:

   - `REALMROOT_WORKER_NAME`
   - `REALMROOT_D1_DATABASE`
   - `REALMROOT_R2_BUCKET`

5. Open **Actions > Deploy Realmroot Fork > Run workflow**.

The default resource names derive from the fork repository. A fork named
`realmroot-example` deploys Worker and D1 names as `realmroot-example`, R2 as
`realmroot-assets-example`.

The fork workflow checks out its own triggering commit and runs
`pnpm run deploy:fork`. The upstream-maintained script is idempotent: it reuses
existing resources by name, creates missing resources, generates a
deployment-only Wrangler config, applies D1 migrations, builds, and deploys.
Existing Worker secrets are preserved.

The Cloudflare API token must be scoped to the intended account and allow
Workers Scripts, D1, R2, and the bindings used by the deployment. Do not
commit the token or put it in a repository variable.

## Auth Realm Boundary

One Realmroot deployment is one auth realm with one user pool and one issuer.
Register multiple OIDC applications in the same deployment only when those
products intentionally share accounts, administrators, login methods, security
policy, connectors, and email settings.

Products that need separate user pools or administrators should use separate
Realmroot deployments. Keep the deployment boundary as the isolation boundary
instead of adding product-level tenant predicates inside one D1 database. See
[Tenancy Model](../architecture/tenancy.md).

## Secrets And Runtime Settings

`BETTER_AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` must be unique for every
auth realm. When the matching GitHub secret is configured, the workflow applies
it. Otherwise it reuses the existing Worker secret or generates one on the first
deployment. Rotating `CREDENTIAL_ENCRYPTION_KEY` requires re-encrypting stored
credentials first.

These settings remain deployment-specific:

- `BETTER_AUTH_URL`: optional canonical deployment origin. The shared user and
  Agent issuer is always `BETTER_AUTH_URL/api/auth`.
- `TRUSTED_ORIGINS`: optional extra first-party Realmroot origins.
- OAuth provider credentials configured in the admin console or Resource API.
- `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, and `WEBAUTHN_ORIGINS` when passkeys
  span custom domains.

The fork generator removes the canonical repository's origin and WebAuthn
values from its generated configuration. A fork that adds a custom domain
should configure its own values in the Worker dashboard before the next
deployment. A fork using only its Workers preview URL can leave them unset.

The generated deployment config enables Wrangler `keep_vars`, so settings
managed on the existing Worker but absent from the upstream template are not
removed during deployment. Secrets are preserved by Wrangler independently.

The canonical `wrangler.toml` remains the source of truth for its runtime
variables. Do not enable `keep_vars` there; removing a committed variable must
also remove it from the canonical Worker on the next deployment.

## Email Routing

Cloudflare Email Routing must be active for the sending domain:

1. Add the domain to Cloudflare.
2. Enable Email Routing for the zone.
3. Complete the required MX and TXT/SPF records.
4. Verify every sender address that administrators may select.

The deployment provides the `EMAIL` binding. Administrators enable delivery and
store the sender name, sender address, and optional reply-to address from
**Console > Settings > Email delivery**. The committed binding does not pin an
address allowlist, so a verified sender can be changed without redeploying the
Worker. Existing deployments may keep `EMAIL_FROM` and `EMAIL_FROM_NAME` as a
temporary bootstrap fallback; saving Email delivery settings moves the effective
configuration into D1.

## Storage

The `ASSET_BUCKET` R2 binding stores uploaded avatars, organization logos,
application logos, branding logos, and favicons. Files remain private and are
served through `/api/assets/{assetId}`.

Keep one R2 bucket and D1 database per auth realm. When migrating an existing
deployment, set the optional repository variables to its current resource names
before the first workflow run so the workflow reuses data rather than creating
empty resources.

## D1 Migrations

The workflow always applies committed migrations through the `DB` binding before
publishing the Worker:

```bash
wrangler d1 migrations apply DB --remote --config wrangler.deployment.toml
```

The generated configuration is runner-local and ignored by Git. Instance
resource IDs never need to be committed to the deployment fork.

Sources:

- [Cloudflare GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
