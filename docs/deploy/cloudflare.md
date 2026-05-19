# Cloudflare Deployment

FlareAuth runs as a Cloudflare Worker with Assets, D1, R2, Email Routing, Queue, and Cron bindings.

## Required Resources

Create one production and one staging resource set per product:

```bash
wrangler d1 create flareauth-db
wrangler d1 create flareauth-db-staging
wrangler r2 bucket create flareauth-assets
wrangler r2 bucket create flareauth-assets-staging
wrangler queues create flareauth-email
wrangler queues create flareauth-email-staging
```

Update `database_id` in `wrangler.toml` and `wrangler.preview.toml` after creating D1 databases.

## Secrets And Vars

Set secrets separately for preview and production:

```bash
wrangler secret put BETTER_AUTH_SECRET
```

Checklist:

- `BETTER_AUTH_SECRET`: 32+ bytes from `openssl rand -base64 32`.
- `BETTER_AUTH_URL`: production issuer origin, for example `https://auth.example.com`.
- `TRUSTED_ORIGINS`: comma-separated product and preview origins.
- OAuth provider credentials configured in the admin console or management API.
- Management API credentials for any product automation.
- Cloudflare account credentials for deployments, D1 migrations, R2, Queues, and Email Routing.
- `EMAIL_FROM` and `EMAIL_FROM_NAME` in Wrangler vars.
- `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, and `WEBAUTHN_ORIGINS` when passkeys are enabled across custom domains and previews.

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
allowed_sender_addresses = ["noreply@agent-kanban.dev"]
```

The `allowed_sender_addresses` value must match a verified address for the product domain.

## Storage

The `ASSET_BUCKET` R2 binding stores uploaded avatars, organization logos, application logos, branding logos, and favicons. Upload endpoints write objects to R2, create `uploaded_asset` rows with purpose, storage key, content type, byte size, SHA-256 checksum, and public URL, then store the asset ID on the user, organization, application, or branding setting.

Uploaded assets are served through the Worker at `/api/assets/{assetId}`. This keeps R2 buckets private while still giving hosted UI and OAuth metadata stable same-origin public URLs. Do not expose the R2 bucket directly unless a future deployment intentionally moves asset delivery behind a public custom domain.

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

Run migrations before deployment. `npm run deploy:prod` runs production migrations, builds, and deploys.
