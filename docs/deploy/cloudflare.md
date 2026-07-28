# Cloudflare Deployment

FlareAuth runs as a Cloudflare Worker with Assets, D1, R2, Email Routing,
Queue, and Cron bindings.

## Repository Model

Keep two clear repository roles:

- `saltbo/flareauth` is the canonical upstream source. Its own Worker deploys
  exclusively through Cloudflare Workers Builds and has no GitHub deployment
  workflow.
- A GitHub fork is one product deployment. Its only operational responsibility
  is holding GitHub Actions credentials and triggering the upstream-maintained
  deployment script.

Do not develop product code in the deployment fork. The workflow checks out
`saltbo/flareauth` directly, so deployment source always comes from upstream.

## Create A Deployment

1. Fork `saltbo/flareauth`.
2. Copy [`deploy/flareauth-fork.yml`](../../deploy/flareauth-fork.yml) to
   `.github/workflows/deploy.yml` in the fork, then enable it from the fork's
   **Actions** tab. This small trigger belongs only to the deployment fork.
3. Add these repository secrets under **Settings > Secrets and variables >
   Actions**:

   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - optional `BETTER_AUTH_SECRET`

4. Add the required repository variable:

   - `FLAREAUTH_EMAIL_FROM`, for example `noreply@example.com`

5. Optionally add:

   - `FLAREAUTH_EMAIL_FROM_NAME`, default `FlareAuth`
   - `FLAREAUTH_WORKER_NAME`
   - `FLAREAUTH_D1_DATABASE`
   - `FLAREAUTH_R2_BUCKET`
   - `FLAREAUTH_EMAIL_QUEUE`

6. Open **Actions > Deploy FlareAuth Fork > Run workflow**.

The default resource names derive from the fork repository. A fork named
`flareauth-example` deploys Worker and D1 names as `flareauth-example`, R2 as
`flareauth-assets-example`, and Queue as `flareauth-email-example`.

The fork workflow checks out upstream and runs `pnpm run deploy:fork`. The
upstream-maintained script is idempotent: it reuses existing resources by name,
creates missing resources, generates a deployment-only Wrangler config, applies
D1 migrations, builds, and deploys. Existing Worker secrets are preserved.

The Cloudflare API token must be scoped to the intended account and allow
Workers Scripts, D1, R2, Queues, and the bindings used by the deployment. Do not
commit the token or put it in a repository variable.

## Auth Realm Boundary

One FlareAuth deployment is one auth realm with one user pool and one issuer.
Register multiple OIDC applications in the same deployment only when those
products intentionally share accounts, administrators, login methods, security
policy, connectors, and email settings.

Products that need separate user pools or administrators should use separate
FlareAuth deployments. Keep the deployment boundary as the isolation boundary
instead of adding product-level tenant predicates inside one D1 database. See
[Tenancy Model](../architecture/tenancy.md).

## Secrets And Runtime Settings

`BETTER_AUTH_SECRET` must be unique for every auth realm. When the GitHub secret
is configured, the workflow applies it. Otherwise it reuses the existing Worker
secret or generates one on the first deployment.

These settings remain deployment-specific:

- `BETTER_AUTH_URL`: optional canonical issuer origin.
- `TRUSTED_ORIGINS`: optional extra first-party FlareAuth origins.
- OAuth provider credentials configured in the admin console or Management API.
- `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, and `WEBAUTHN_ORIGINS` when passkeys
  span custom domains.

The generated deployment config enables Wrangler `keep_vars`, so settings
managed on the existing Worker but absent from the upstream template are not
removed during deployment. Secrets are preserved by Wrangler independently.

## Email Routing

Cloudflare Email Routing must be active for the sending domain:

1. Add the domain to Cloudflare.
2. Enable Email Routing for the zone.
3. Complete the required MX and TXT/SPF records.
4. Verify the address used by `FLAREAUTH_EMAIL_FROM`.

The workflow uses the same address for the `EMAIL_FROM` variable and the
`EMAIL` binding allowlist, avoiding mismatched sender configuration.

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
