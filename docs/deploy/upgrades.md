# Deployment Upgrades

FlareAuth deployment forks track the canonical application source while keeping
an explicit deployment boundary. Their small, deployment-only workflow checks
out the triggering fork commit. The upstream repository itself has no GitHub
deployment workflow.

## Normal Upgrade

From the deployment fork:

1. Select **Sync fork > Update branch** on GitHub.
2. Wait for **Deploy FlareAuth Fork** to complete.
3. Run the smoke tests below.

The sync produces a push to the fork's `main` branch, which triggers deployment
automatically. The deployed source is exactly that new fork commit.

The equivalent GitHub CLI command is:

```bash
gh repo sync OWNER/FLAREAUTH_FORK --branch main
```

No local clone of the deployment fork is required.

## Redeploy A Fork Ref

Run **Deploy FlareAuth Fork** manually and select an existing fork branch or
tag in GitHub's workflow ref selector.

Pinned deployment changes code only. It continues to use the fork's configured
Worker, D1, R2, Queue, sender, and existing secrets.

## Deployment Configuration

Deployment-specific values belong in GitHub Actions secrets and variables, not
in committed application files:

- secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and optionally
  `BETTER_AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`
- required variable: `FLAREAUTH_EMAIL_FROM`
- optional variables: `FLAREAUTH_EMAIL_FROM_NAME`, `FLAREAUTH_WORKER_NAME`,
  `FLAREAUTH_D1_DATABASE`, `FLAREAUTH_R2_BUCKET`, and
  `FLAREAUTH_EMAIL_QUEUE`

Deployments with a custom domain should set `BETTER_AUTH_URL` to that immutable
public origin. Both users and Agents use its `/api/auth` issuer.

Resource override variables are primarily for adopting an existing deployment
whose names do not match the fork-name convention.

The canonical `saltbo/flareauth` repository never runs the fork deployment job.
It continues to deploy its own Worker through Cloudflare Workers Builds.

## Migrations And Rollback

Every workflow deployment applies pending D1 migrations before publishing code.
Review migration release notes before intentionally deploying an older commit:
database migrations are not rolled back by selecting older code.

## Smoke Tests

After deployment, verify:

```bash
curl https://AUTH_ORIGIN/api/configz
curl https://AUTH_ORIGIN/api/auth/.well-known/openid-configuration
curl https://AUTH_ORIGIN/api/management/openapi.json
```

Confirm the issuer matches the deployment origin, then use the FlareAuth Restish
skill to run `get-readiness` and at least one generated read-only Management API
operation.

Source:

- [GitHub: Syncing a fork](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/syncing-a-fork)
