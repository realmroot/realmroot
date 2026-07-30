<p align="center">
  <img src="assets/logo.png" alt="Realmroot logo" width="132" height="132" />
</p>

<h1 align="center">Realmroot</h1>

<p align="center">
  Identity and delegated access infrastructure for people, applications,
  APIs, and Agents.
</p>

<p align="center">
  <a href="https://github.com/saltbo/realmroot/actions/workflows/ci.yaml"><img src="https://github.com/saltbo/realmroot/actions/workflows/ci.yaml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/saltbo/realmroot.svg" alt="License" /></a>
  <a href="https://codecov.io/gh/saltbo/realmroot"><img src="https://codecov.io/gh/saltbo/realmroot/branch/main/graph/badge.svg" alt="Coverage" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D24-339933.svg" alt="Node >=24" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/TypeScript-6.x-3178c6.svg" alt="TypeScript 6.x" /></a>
</p>

## What It Is

Realmroot gives a product team its own identity root: one user pool, one issuer,
one admin console, and one hosted account center. Multiple applications can
share the same realm when they should share accounts and administrators.

The same realm gives Agents stable identities and controller-approved,
scope-bound access to native and external API resources.

For products that need separate users, administrators, issuer URLs, or sign-in
policy, deploy another Realmroot instance.

## Why Realmroot

Better Auth is a strong foundation, but wiring it into every product means
repeating the same user tables, hosted pages, OAuth clients, admin controls,
email flows, security policy, deployment settings, and operational checks.

Realmroot packages that work once as a deployable identity and delegated-access
service. Product apps integrate through OIDC, while teams manage users,
applications, Agents, API resources, connectors, grants, and policy from one
dedicated control plane.

## Core Architecture

Realmroot runs Better Auth inside a Cloudflare Worker. The Worker serves hosted
auth pages, account management, admin APIs, OIDC discovery, OAuth flows, and
Resource API endpoints from the same deployment.

Cloudflare D1 stores auth and configuration data, Drizzle owns the schema, Hono
exposes the HTTP surface, and the React console provides the hosted user and
admin experience.

## Highlights

- Hosted sign-in, sign-up, password recovery, and OAuth consent.
- Account center for profile, credentials, sessions, MFA, passkeys, and linked
  accounts.
- Admin console for applications, users, connectors, security policy, branding,
  organizations, roles, API resources, webhooks, and deployment readiness.
- Standard OIDC integration for product applications.
- Public Resource API with generated OpenAPI contract.
- Stable Agent identities with controller-approved native and external API
  resource access.
- Agent-operable administration through an installable Realmroot skill and
  Restish plugin.
- Fork-and-deploy GitHub Actions setup for low-cost per-product deployments.

## Core Capabilities

### Hosted Auth

Use Realmroot as the identity provider for your product applications. Product
apps integrate through standard OIDC discovery, authorization code with PKCE,
token exchange, and callback handling.

### Account Center

Users can manage their profile, password, MFA, passkeys, active sessions, linked
accounts, and authorized applications from the hosted account center.

### Admin Console

Administrators can configure product applications, login methods, external
identity connectors, branding, security requirements, organizations, roles,
API resources, webhooks, and deployment health.

### Resource API

Every administrative capability is available through the unified Resource API.
Its OpenAPI contract is served by each deployment at:

```text
/api/openapi.json
```

## Deploy

Deploy each product auth realm from a GitHub fork:

1. Fork `saltbo/realmroot`.
2. Install [`deploy/realmroot-fork.yml`](deploy/realmroot-fork.yml) as
   `.github/workflows/deploy.yml` in the fork and enable GitHub Actions.
3. Add the Cloudflare deployment secrets and sender variable described in
   [Cloudflare deployment](docs/deploy/cloudflare.md).
4. Run **Deploy Realmroot Fork** once.

Later upgrades only require **Sync fork**. The resulting push to the fork's
`main` branch deploys that exact fork commit automatically. The canonical
`saltbo/realmroot` repository has no GitHub deployment workflow: its Worker
continues to deploy exclusively through Cloudflare Workers Builds.

After deployment:

1. Open the deployed URL.
2. Complete first-admin onboarding.
3. Configure sign-in methods and product applications in the admin console.
4. Point product applications at the deployment's OIDC discovery URL.

For upgrade and operational details, see:

- [Cloudflare deployment](docs/deploy/cloudflare.md)
- [Deployment upgrades](docs/deploy/upgrades.md)
- [Fresh deployment setup](docs/deploy/setup.md)
- [Tenancy model](docs/architecture/tenancy.md)

## Use From An App

Register an application in Realmroot, configure its redirect URI, then use the
deployment's OIDC discovery endpoint:

```text
/api/auth/.well-known/openid-configuration
```

Public browser and native clients should use authorization code with PKCE.
Server-side confidential clients should authenticate at the token endpoint using
the client credentials shown in the Realmroot application record.

Product applications do not call the Resource API for normal user login. It is
for administration and automation.

## Use From Agents

Install the Realmroot skill globally, selecting the Agent runtime that should
use it:

```bash
npx skills add realmroot/realmroot -g --skill realmroot
```

For a non-interactive Codex installation:

```bash
npx skills add realmroot/realmroot -g --skill realmroot --agent codex -y
```

Verify the installed source and scope:

```bash
npx skills list -g
```

Then tell your agent what to configure:

```text
Use Realmroot to add identity and delegated Agent access to this project.
```

The agent will ask for the Realmroot deployment and application details it needs.

### Update The Agent Skill

Update the global installation from the latest `realmroot/realmroot` revision:

```bash
npx skills update realmroot -g -y
```

If the installation source or generated Agent links are inconsistent, perform a
clean reinstall:

```bash
npx skills remove realmroot -g -y
npx skills add realmroot/realmroot -g --skill realmroot --agent codex -y
```

Use the `skills` CLI to manage the installation. Do not manually copy
`skills/realmroot` into `~/.agents/skills` or an Agent-specific skill directory;
manual copies are not tracked by `skills update` and can leave conflicting
versions installed.

## Documentation

- [Technical documentation index](docs/README.md)
- [Resource API](docs/api/resource-api.md)
- [Resource server integration](docs/integrations/resource-servers.md)
- [Auth provider architecture](docs/architecture/auth-provider.md)
- [Agent identity architecture](docs/architecture/agent-identity.md)
- [Cloudflare deployment](docs/deploy/cloudflare.md)
