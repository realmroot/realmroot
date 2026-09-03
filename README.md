<p align="center">
  <img src="https://realmroot.dev/assets/logo.png" alt="Realmroot logo" width="132" />
</p>

<h1 align="center">Realmroot</h1>

<p align="center">
  <strong>Every API. Agent-ready.</strong>
</p>

<p align="center">
  Realmroot lets Agents discover and securely use the OpenAPI services you already run.<br />
  Service teams keep their existing APIs—no custom Agent integration required.
</p>

<p align="center">
  <a href="https://realmroot.dev">Website</a> ·
  <a href="https://realmroot.dev/docs/">Documentation</a> ·
  <a href="https://realmroot.dev/docs/getting-started/quick-start/">Quick start</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/realmroot/realmroot/actions/workflows/ci.yaml"><img src="https://github.com/realmroot/realmroot/actions/workflows/ci.yaml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/realmroot/realmroot.svg" alt="License" /></a>
  <a href="https://codecov.io/gh/realmroot/realmroot"><img src="https://codecov.io/gh/realmroot/realmroot/branch/main/graph/badge.svg" alt="Coverage" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D24-339933.svg" alt="Node >=24" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/TypeScript-6.x-3178c6.svg" alt="TypeScript 6.x" /></a>
</p>

## Why Realmroot

The useful capabilities Agents need already exist behind APIs. The missing
piece is a shared way to discover those capabilities, understand their live
contracts, establish who is acting, and obtain only the authority required for
the current task.

Without that shared path, every service team must build and maintain another
Agent-facing integration. Contracts drift, authorization logic gets copied,
personal credentials leak into automation, and each Agent runtime needs another
adapter.

Realmroot provides that path while preserving the system boundary that already
works: the Agent calls the original API directly, and the API keeps the final
authorization decision.

> **Discover broadly. Authorize precisely. Call directly.**

## One Product, Two Layers

### The Agent Tool Plane

Realmroot registers protected APIs as discoverable Resources. Agents inspect
their live OpenAPI contracts, select an operation, request the exact scopes they
need, and invoke the original service through a shared operating model.

This makes existing APIs available to Agents without creating an Agent-specific
backend for every service. [Learn about the Agent Tool Plane](https://realmroot.dev/docs/concepts/agent-tool-plane/).

### Identity And Trust Infrastructure

Every Agent has a stable identity independent of its current Host or runtime.
Controllers approve bounded grants, credentials are short-lived, and access can
be audited and revoked without exposing a user's long-lived credentials.

The same realm also provides hosted authentication, OAuth/OIDC, an Account
Center, and an Admin Console for people, applications, organizations, and
Agents. [Learn about the identity foundation](https://realmroot.dev/docs/guides/product-identity-root/).

## How It Works

1. An API team publishes a protected Resource and its live OpenAPI contract.
2. An Agent discovers the Resource and selects the operation needed for a task.
3. Realmroot binds the request to a stable Agent and asks its controller to
   approve an exact scope set and lifetime.
4. The Agent receives a short-lived credential and calls the API directly. The
   API validates the request and applies its own business rules.

Realmroot is not an HTTP proxy and does not become a second source of business
permissions. [See the complete request path](https://realmroot.dev/docs/getting-started/how-it-works/).

## Why Teams Use It

- **Reuse the APIs you already operate.** OpenAPI remains the live operation
  contract instead of being copied into a separate tool definition.
- **Keep authorization where it belongs.** Realmroot coordinates identity,
  approval, and credential issuance; each service still enforces its own data
  and business rules.
- **Separate identity from authority.** Enrollment identifies the Agent. A
  grant independently authorizes one Resource, scope set, account, and lifetime.
- **Avoid sharing personal credentials.** Agents use bounded, short-lived
  credentials rather than a controller's API key or refresh token.
- **Own the deployment boundary.** Realmroot is open source and deploys as an
  isolated realm on Cloudflare.

## Choose Your Path

| You are | Start here |
| --- | --- |
| An Agent user or developer who wants to use a private API | [Quick start](https://realmroot.dev/docs/getting-started/quick-start/) · [Realmroot Skills](https://realmroot.dev/docs/guides/agent-skills/) |
| An API team that wants to expose an existing service to Agents | [Make an API Agent-ready](https://realmroot.dev/docs/guides/make-an-api-agent-ready/) |
| A product or platform team that needs identity for people, applications, and Agents | [Product identity foundation](https://realmroot.dev/docs/guides/product-identity-root/) · [Deploy Realmroot](https://realmroot.dev/docs/guides/deploy-realmroot/) |
| A security team evaluating trust, delegation, and enforcement | [Agent identity and authority](https://realmroot.dev/docs/concepts/agent-authority/) · [Authorization boundary](https://realmroot.dev/docs/concepts/authorization-boundary/) |

## Open Source

Realmroot is licensed under [Apache 2.0](LICENSE). The service runs on
Cloudflare Workers with D1 and R2; the hosted Account Center and Admin Console
are built with React.

Read the [documentation](https://realmroot.dev/docs/) for concepts, integration
guides, deployment, and operational details.
