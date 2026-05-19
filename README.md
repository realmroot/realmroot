# FlareAuth

[![CI](https://github.com/saltbo/flareauth/actions/workflows/ci.yml/badge.svg)](https://github.com/saltbo/flareauth/actions/workflows/ci.yml)
[![E2E](https://github.com/saltbo/flareauth/actions/workflows/e2e.yml/badge.svg)](https://github.com/saltbo/flareauth/actions/workflows/e2e.yml)
[![License](https://img.shields.io/github/license/saltbo/flareauth.svg)](LICENSE)
[![Coverage](https://codecov.io/gh/saltbo/flareauth/branch/main/graph/badge.svg)](https://codecov.io/gh/saltbo/flareauth)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178c6.svg)](package.json)

Cloudflare-native identity provider built on Better Auth.

## Stack

- Cloudflare Workers and Assets
- Cloudflare D1
- Hono API
- Better Auth with OIDC provider
- React and Vite
- Drizzle ORM

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run test:e2e
```

Code coverage is uploaded from CI to Codecov. Browser E2E status is reported by the E2E workflow; the suite enforces complete declared journey coverage from `tests/e2e/journey-coverage.json`.

Check Cloudflare binding coverage before review:

```bash
npm run deploy:check
```

## Cloudflare Environments

The repository uses one Cloudflare Worker and separate staging/production Cloudflare resources:

- Worker `flareauth`
- Production D1 `flareauth-db`
- Staging preview D1 `flareauth-db-staging`
- Production R2 `flareauth-assets`
- Staging R2 `flareauth-assets-staging`
- Production Queue `flareauth-email`
- Staging Queue `flareauth-email-staging`

Deploy production manually:

```bash
npm run deploy:prod
```

Cloudflare Dashboard should own deployments for this repository.

Connect the repository in Cloudflare Dashboard and use:

- Production branch: `main`
- Build command: `npm run build`
- Production Worker: `flareauth`
- Preview deployments: enabled for pull requests and non-main branches
- Production D1 binding `DB`: `flareauth-db`
- Preview D1 binding `DB`: `flareauth-db-staging`
- R2 binding `ASSET_BUCKET`: environment-specific avatar/logo storage
- Email binding `EMAIL`: verified Cloudflare Email Routing sender
- Queue binding `EMAIL_QUEUE`: environment-specific email queue
- Cron trigger: `*/15 * * * *`

`npm run build` follows the same pattern as zpan: Cloudflare preview branch builds
use the preview Wrangler config, while `main` and local builds use production
config. Pull requests still run GitHub CI for typecheck, lint, tests, and build,
but deployment and preview URLs come from Cloudflare Dashboard, not GitHub Actions.

## Fresh Onboarding

For a fresh deployment, create the resources, set secrets, run D1 migrations, deploy, then open `/onboarding` to create the first admin from the browser. The CLI helper uses the same onboarding API:

```bash
FLAREAUTH_URL=https://auth.example.com \
FLAREAUTH_ADMIN_EMAIL=admin@example.com \
FLAREAUTH_ADMIN_PASSWORD='replace-with-a-long-password' \
npm run bootstrap:admin
```

First-admin onboarding is available only while the D1 database has no users. After the first admin exists, `/api/onboarding/status` returns `{ "required": false }` and `/api/onboarding/admin-users` is locked.

Frontend runtime state is read from `/api/configz`. Hosted auth actions use Better Auth native `/api/auth/*` routes, and product applications should integrate with standard OIDC discovery plus authorization code with PKCE. If a consuming product also uses Better Auth, it can use Better Auth as an OIDC client; product apps do not need FlareAuth management or account APIs.

## Deployment Docs

- [Cloudflare deployment](docs/deploy/cloudflare.md)
- [Fresh deployment setup](docs/deploy/setup.md)
- [Review environment acceptance](docs/deploy/acceptance.md)
- [Logto parity product acceptance map](docs/product/logto-parity.md)
