# Fresh Deployment Onboarding

First-admin onboarding is open only while the database has no users.

1. Create Cloudflare resources and update Wrangler IDs.
2. Set required secrets and vars.
3. Run migrations.
4. Deploy the Worker.
5. Open browser onboarding:

```bash
open https://auth.example.com/onboarding
```

The status API returns this before the first user:

```bash
curl https://auth.example.com/api/onboarding/status
```

```json
{ "required": true }
```

6. Create the first admin in the browser, or use the CLI helper:

```bash
FLAREAUTH_URL=https://auth.example.com \
FLAREAUTH_ADMIN_EMAIL=admin@example.com \
FLAREAUTH_ADMIN_PASSWORD='replace-with-a-long-password' \
FLAREAUTH_ADMIN_NAME='Admin User' \
npm run bootstrap:admin
```

The endpoint creates the first admin user and credential account only when the user table is empty. Later calls return `403`.

After admin sign-in, open `/admin/onboarding` to create the first OIDC client and copy the discovery, issuer, client ID, redirect URI, and PKCE integration details.

## Local Smoke Check

Before opening a review PR:

```bash
npm run deploy:check
npm run typecheck
npm run lint
npm test
```
