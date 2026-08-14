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
REALMROOT_URL=https://auth.example.com \
REALMROOT_ADMIN_EMAIL=admin@example.com \
REALMROOT_ADMIN_PASSWORD='replace-with-a-long-password' \
REALMROOT_ADMIN_NAME='Admin User' \
pnpm run bootstrap:admin
```

The endpoint creates the first admin user and credential account only when the user table is empty. Later calls return `403`.

After admin sign-in, open `/console/applications` and use the create action to register the first OIDC client.

## Local Smoke Check

Before opening a review PR:

```bash
pnpm run deploy:check
pnpm run typecheck
pnpm run lint
pnpm test
```
