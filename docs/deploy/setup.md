# Fresh Deployment Setup

The setup API is open only while the database has no users.

1. Create Cloudflare resources and update Wrangler IDs.
2. Set required secrets and vars.
3. Run migrations.
4. Deploy the Worker.
5. Check setup status:

```bash
curl https://auth.example.com/api/setup
```

Expected response before the first user:

```json
{ "required": true }
```

6. Create the first admin:

```bash
FLAREAUTH_URL=https://auth.example.com \
FLAREAUTH_ADMIN_EMAIL=admin@example.com \
FLAREAUTH_ADMIN_PASSWORD='replace-with-a-long-password' \
FLAREAUTH_ADMIN_NAME='Admin User' \
npm run bootstrap:admin
```

The endpoint creates the first admin user and credential account only when the user table is empty. Later calls return `403`.

## Local Smoke Check

Before opening a review PR:

```bash
npm run deploy:check
npm run typecheck
npm run lint
npm test
```
