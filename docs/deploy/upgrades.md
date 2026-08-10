# Deployment Upgrades

Realmroot deployment forks track the canonical application source while keeping
an explicit deployment boundary. Their small, deployment-only workflow checks
out the triggering fork commit. The upstream repository itself has no GitHub
deployment workflow.

## Normal Upgrade

From the deployment fork:

1. Select **Sync fork > Update branch** on GitHub.
2. Wait for **Deploy Realmroot Fork** to complete.
3. Run the smoke tests below.

The sync produces a push to the fork's `main` branch, which triggers deployment
automatically. The deployed source is exactly that new fork commit.

The equivalent GitHub CLI command is:

```bash
gh repo sync OWNER/REALMROOT_FORK --branch main
```

No local clone of the deployment fork is required.

## Redeploy A Fork Ref

Run **Deploy Realmroot Fork** manually and select an existing fork branch or
tag in GitHub's workflow ref selector.

Pinned deployment changes code only. It continues to use the fork's configured
Worker, D1, R2, and existing secrets.

## Deployment Configuration

Deployment-specific values belong in GitHub Actions secrets and variables, not
in committed application files:

- secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and optionally
  `BETTER_AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`
- optional variables: `REALMROOT_WORKER_NAME`, `REALMROOT_D1_DATABASE`, and
  `REALMROOT_R2_BUCKET`

Email sender identity is now stored in D1 through **Console > Settings > Email
delivery**. Existing `EMAIL_FROM` and `EMAIL_FROM_NAME` Worker variables remain
an upgrade fallback until the settings are saved, but new deployments do not
require them. The unused `EMAIL_QUEUE` producer can be removed.

Deployments with a custom domain should set `BETTER_AUTH_URL` to that immutable
public origin. Both users and Agents use its `/api/auth` issuer.

Resource override variables are primarily for adopting an existing deployment
whose names do not match the fork-name convention.

Provider lifecycle publishers authenticate as confidential Applications using
the `client_credentials` grant and an Application Permission for
`connection-events:write` on the Realmroot Resource Server.

The canonical `saltbo/realmroot` repository never runs the fork deployment job.
It continues to deploy its own Worker through Cloudflare Workers Builds, or
manually with the equivalent `pnpm run deploy` command. Both paths use the
committed `wrangler.toml`.

## Migrations And Rollback

Every workflow deployment applies pending D1 migrations before publishing code.
Review migration release notes before intentionally deploying an older commit:
database migrations are not rolled back by selecting older code.

### Tenant ownership schema cutover

The tenant ownership migration is intentionally one-way and the corresponding
Worker does not support the previous schema. For this upgrade:

1. stop writes to the Realmroot Worker;
2. create and verify a D1 backup;
3. apply pending migrations and require the ownership verifier to succeed;
4. deploy the matching Worker immediately;
5. verify health, sign-in, User Agent inventory, Organization resource isolation,
   Application consent account switching, and Realm audit inventory;
6. restore writes only after those checks pass.

Do not deploy the new Worker when the migration fails. Records whose historical
audit owner cannot be proved are listed in `ownership_quarantine` and are not
served from the normal audit collection. Roll forward from the backup and the
failed migration evidence; do not add runtime fallback logic.

## Agent Client Compatibility

Deploying a new Worker does not update globally installed Realmroot skills or
the Restish adapter. After an Agent protocol or resource-authorization upgrade,
update both with the procedure in [Use From Agents](../../README.md#use-from-agents)
before running the smoke journey.

The adapter migrates protected local state in place. Stable Agent and Host keys
survive supported upgrades, while ambiguous legacy or authorization-mode-less
DPoP credential caches are removed. This deliberately requires a current active
resource grant instead of silently carrying target authority across an
incompatible model change. Do not restore discarded credentials from backups or
manually edit the state files.

## Smoke Tests

After deployment, verify:

```bash
curl https://AUTH_ORIGIN/api/configz
curl https://AUTH_ORIGIN/api/auth/.well-known/openid-configuration
curl https://AUTH_ORIGIN/api/openapi.json
```

Confirm that the issuer matches the deployment origin and that the OpenAPI
document describes the expected deployment version.

Source:

- [GitHub: Syncing a fork](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/syncing-a-fork)
