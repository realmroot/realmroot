# FlareAuth

[![CI](https://github.com/saltbo/flareauth/actions/workflows/ci.yml/badge.svg)](https://github.com/saltbo/flareauth/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/saltbo/flareauth.svg)](LICENSE)
[![Code Coverage](https://img.shields.io/badge/code%20coverage-90%25%20required-blue.svg)](vite.config.ts)
[![E2E Journeys](https://img.shields.io/badge/E2E%20journeys-100%25%20required-blue.svg)](tests/e2e/journey-coverage.json)
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

Coverage gates target 90% overall automated code coverage and 100% critical browser journey coverage. Browser journey coverage is declared in `tests/e2e/journey-coverage.json`.

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

## Fresh Setup

For a fresh deployment, create the resources, set secrets, run D1 migrations, deploy, then create the first admin:

```bash
FLAREAUTH_URL=https://auth.example.com \
FLAREAUTH_ADMIN_EMAIL=admin@example.com \
FLAREAUTH_ADMIN_PASSWORD='replace-with-a-long-password' \
npm run bootstrap:admin
```

Setup is available only while the D1 database has no users. After the first admin exists, `/api/setup` returns `{ "required": false }` and `/api/setup/admin` is locked.

## Deployment Docs

- [Cloudflare deployment](docs/deploy/cloudflare.md)
- [Fresh deployment setup](docs/deploy/setup.md)
- [Review environment acceptance](docs/deploy/acceptance.md)
