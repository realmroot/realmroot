# Review Environment Acceptance

Use this path for preview and production review.

## Preview

1. Confirm Cloudflare created a preview deployment from the PR branch.
2. Run staging migrations:

```bash
npm run db:migrate:staging
```

3. Open the preview URL and confirm `/api/health` returns `{ "ok": true, "service": "flareauth" }`.
4. If the preview D1 database is fresh, run the first-admin setup script against the preview URL.
5. Sign in as the admin user.
6. Open `/admin` and verify the dashboard loads.
7. Create a test user from Admin > Users.
8. Create or inspect an application from Admin > Applications.
9. Exercise the public sign-in flow from `/sign-in`.
10. Confirm email flows send from the verified Cloudflare sender.

## Production

1. Confirm production secrets and bindings use production resources.
2. Run `npm run deploy:prod`.
3. Run first-admin setup only for a fresh production database.
4. Repeat the preview journey on the production custom domain.
5. Confirm setup is locked:

```bash
curl https://auth.example.com/api/setup
```

Expected response after setup:

```json
{ "required": false }
```
