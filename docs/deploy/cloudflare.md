# Cloudflare Deployment

FlareAuth runs as a Cloudflare Worker with Assets, D1, R2, Email Routing, Queue, and Cron bindings.

Deploy a new product auth realm from the repository button:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/saltbo/flareauth)

## Auth Realm Boundary

One FlareAuth deployment is one auth realm with one user pool and one issuer.
Register multiple OIDC applications in the same deployment only when those
products intentionally share accounts, administrators, login methods, security
policy, connectors, and email settings.

Products that need separate user pools or administrators should use separate
FlareAuth deployments. Keep the deployment boundary as the isolation boundary
instead of adding product-level tenant predicates inside one D1 database. See
[Tenancy Model](../architecture/tenancy.md).

## Required Resources

Cloudflare Deploy Button reads `wrangler.toml`, clones the repository into the
operator's GitHub/GitLab account, provisions supported resources, fills generated
resource IDs into the cloned repository, configures Workers Builds, and deploys
the Worker. Use the button for each product auth realm. The button should only
need the `BETTER_AUTH_SECRET` from `.dev.vars.example` during the initial flow.
The template keeps placeholder D1 and R2 resource fields so Cloudflare has
configuration keys to replace in the cloned deployment repository.

If you are creating resources manually instead, create one production and one
staging resource set per product:

```bash
wrangler d1 create flareauth
wrangler d1 create flareauth-staging
wrangler r2 bucket create flareauth-assets
wrangler r2 bucket create flareauth-assets-staging
wrangler queues create flareauth-email
wrangler queues create flareauth-email-staging
```

Update `database_id` in `wrangler.toml` and `wrangler.preview.toml` after
creating D1 databases manually. Deploy Button handles this resource provisioning
step for button-created deployments by replacing the placeholder IDs in the
cloned deployment repository, not in the upstream template.

## Secrets And Vars

Set secrets separately for preview and production:

```bash
wrangler secret put BETTER_AUTH_SECRET
```

Checklist:

- `BETTER_AUTH_SECRET`: 32+ bytes from `openssl rand -base64 32`.
- `BETTER_AUTH_URL`: optional production issuer origin, for example `https://auth.example.com`. When omitted, FlareAuth uses the request origin.
- `TRUSTED_ORIGINS`: optional comma-separated first-party FlareAuth origins,
  such as admin console, account center, and deployment preview origins. When
  omitted, FlareAuth trusts the resolved issuer origin. Configure OAuth/OIDC
  application browser origins in each Application's CORS origins setting instead
  of putting every product origin here.
- OAuth provider credentials configured in the admin console or management API.
- Management API credentials for any product automation.
- Cloudflare account credentials for deployments, D1 migrations, R2, Queues, and Email Routing.
- `EMAIL_FROM` and `EMAIL_FROM_NAME` in Wrangler vars.
- `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, and `WEBAUTHN_ORIGINS` when passkeys are enabled across custom domains and previews.

Set a fresh `BETTER_AUTH_SECRET` for every product deployment and every
environment. Do not reuse one secret across independent auth realms.

Deploy Button reads `.dev.vars.example` and prompts operators to fill required
secrets. Keep this file minimal. Instance domains and trusted origins can be
configured after the deployment repository is created, or omitted when the
deployment uses a single custom domain.

Deploy Button creates a deployment repository for the product instance. Keep
instance values in that repository, not in the upstream FlareAuth template. See
[Deployment upgrades](upgrades.md) for the upstream sync workflow.

The upstream FlareAuth repository keeps `wrangler.toml` as the Deploy Button
template. If upstream maintainers need to deploy their own production Worker,
they should use `wrangler.production.toml` through `npm run deploy:self`. That
configuration uses the Worker `workers.dev` origin and does not include a custom
domain.

## Email Routing

Cloudflare Email Routing must be active for the sending domain before deployment mail can be sent.

1. Add the domain to Cloudflare.
2. Enable Email Routing for the zone.
3. Complete the DNS records Cloudflare provides, including MX and TXT/SPF records.
4. Verify the sender address used by `EMAIL_FROM`.
5. Keep the Worker binding in both Wrangler configs:

```toml
[[send_email]]
name = "EMAIL"
allowed_sender_addresses = ["noreply@example.com"]
```

The `allowed_sender_addresses` value must match a verified address for the product domain.

For the first Deploy Button pass, leave the template sender in place if needed.
After the deployment repository is created, update `EMAIL_FROM` and
`allowed_sender_addresses` to the verified product sender, then redeploy.

## Storage

The `ASSET_BUCKET` R2 binding stores uploaded avatars, organization logos, application logos, branding logos, and favicons. Upload endpoints write objects to R2, create `uploaded_asset` rows with purpose, storage key, content type, byte size, SHA-256 checksum, and public URL, then store the asset ID on the user, organization, application, or branding setting.

Uploaded assets are served through the Worker at `/api/assets/{assetId}`. This keeps R2 buckets private while still giving hosted UI and OAuth metadata stable same-origin public URLs. Do not expose the R2 bucket directly unless a future deployment intentionally moves asset delivery behind a public custom domain.

### AgentAuth Foundation Limitation

The delegated AgentAuth foundation is an integration milestone, not a production-ready delegated-agent launch gate. `@better-auth/agent-auth@0.5.1` stores JWT replay `jti` entries and fetched JWKS documents in process memory unless Better Auth is configured with shared `secondaryStorage`. Cloudflare Workers memory is isolate-local, so replay protection and JWKS caching are not durable across isolates. This milestone also allows dynamic host registration for delegated protocol compatibility; production enablement must pair that with an explicit host trust policy. Before enabling AgentAuth for production traffic, add a shared secondary storage adapter suitable for Workers, preferably Durable Object-backed or D1-backed storage with strong enough consistency for replay checks.

SVG uploads are intentionally rejected because asset URLs are served from the auth origin.

Keep staging and production buckets separate to avoid leaking preview assets into production.

## D1 Migrations

Local development:

```bash
npm run db:migrate
```

Staging preview:

```bash
npm run db:migrate:staging
```

Production:

```bash
npm run db:migrate:prod
```

Run migrations before deployment. `npm run deploy` runs remote D1 migrations
through the `DB` binding, builds, and deploys. Using the binding name keeps the
script compatible with Deploy Button generated database names.

Sources:

- [Cloudflare Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
