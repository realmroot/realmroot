# FlareAuth

[![CI](https://github.com/saltbo/flareauth/actions/workflows/ci.yml/badge.svg)](https://github.com/saltbo/flareauth/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)
[![Stack: Cloudflare + Hono + React](https://img.shields.io/badge/stack-Cloudflare%20%2B%20Hono%20%2B%20React-24292f.svg)](package.json)
[![Open Source](https://img.shields.io/badge/open%20source-yes-brightgreen.svg)](LICENSE)
[![Coverage Thresholds](https://img.shields.io/badge/coverage-62%25%20lines%20%7C%2060%25%20branches-informational.svg)](vite.config.ts)
[![UI Journey E2E](https://img.shields.io/badge/UI%20journey%20E2E-25%2F25%20journeys-success.svg)](tests/e2e/journey-coverage.json)
[![Hono RPC Smoke](https://img.shields.io/badge/Hono%20RPC%20smoke-1%2F1%20journeys-success.svg)](tests/e2e/journey-coverage.json)
[![Platform Status](https://img.shields.io/badge/platform%20status-%2Fapi%2Fhealth-success.svg)](server/app.ts)

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

Browser UI journey coverage is declared in `tests/e2e/journey-coverage.json` and currently covers 25/25 declared critical product journeys. The same suite includes a Hono RPC smoke path for the product-facing platform status journey through the real `/api/health` handler; remaining browser journeys use deterministic API fixtures and are backed by server route tests for Hono behavior.

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
