<p align="center">
  <img src="https://realmroot.dev/assets/logo.png" alt="Realmroot logo" width="132" />
</p>

<h1 align="center">Realmroot</h1>

<p align="center">
  <strong>Every API, Agent-ready.</strong>
</p>

<p align="center">
  Realmroot turns existing OpenAPI services into secure, discoverable tools for
  Agents—without requiring every resource server to build and maintain a
  separate Agent integration.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/saltbo/realmroot/actions/workflows/ci.yaml"><img src="https://github.com/saltbo/realmroot/actions/workflows/ci.yaml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/saltbo/realmroot.svg" alt="License" /></a>
  <a href="https://codecov.io/gh/saltbo/realmroot"><img src="https://codecov.io/gh/saltbo/realmroot/branch/main/graph/badge.svg" alt="Coverage" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D24-339933.svg" alt="Node >=24" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/TypeScript-6.x-3178c6.svg" alt="TypeScript 6.x" /></a>
</p>

## Make The Existing Internet Available To Agents

The internet already has decades of useful APIs. The missing piece is not
another copy of every API—it is a reliable way for an Agent to discover the
right capability, obtain the exact authority it needs, and invoke the existing
service.

Purpose-built MCP servers and custom CLIs are useful when a tool needs a
specialized interaction model. Requiring one for every resource server,
however, creates a second integration surface with an open-ended maintenance
cost. API and tool definitions can drift, security fixes must be applied twice,
and each Agent runtime needs another adapter.

Realmroot follows a reusable path:

1. A resource server maintains its API, RFC 9728 scope metadata, OpenAPI
   document, and permission enforcement.
2. Realmroot registers the resource, makes it discoverable, and handles Agent
   identity and delegated authorization.
3. Restish turns the OpenAPI contract into generic CLI operations.
4. The Realmroot Skill teaches an Agent how to discover, request, and invoke
   those operations.

The resource server does not need an Agent-specific API. The Agent's available
toolbox grows as more resource servers are registered with Realmroot.

## Two Layers Of Value

### The Agent Tool Plane

Realmroot helps Agents solve two fundamental problems: **tool discovery** and
**tool invocation**.

- discover registered private APIs as capabilities instead of preinstalling a
  bespoke integration for each service;
- inspect the service's live OpenAPI contract instead of relying on a copied
  tool definition;
- request only the resource and scopes needed for the current task;
- use Restish as a generic, composable CLI over the API;
- call the resource server directly with a short-lived credential.

### The Identity And Trust Foundation

Realmroot is also a complete, deployable identity root for a product or realm:

- one user pool, issuer, client registry, administrative boundary, and security
  policy;
- hosted sign-in, sign-up, recovery, consent, MFA, passkeys, and sessions;
- OIDC/OAuth integration for public, native, and confidential applications;
- an Account Center for users and an Admin Console for operators;
- stable Agent identities, controller relationships, delegated grants,
  revocation, and audit context.

This layer has value even without Agents: it prevents every product from
rebuilding authentication flows, identity tables, application clients, account
management, and administrative controls. For Agent workloads, it provides the
people, organizations, applications, and policy boundary required to answer
who controls an Agent and what it may request.

Tools without identity are unsafe. Identity without useful capabilities does
not complete the Agent's task. Realmroot joins both layers while leaving final
business authorization where it belongs: inside the resource server.

Read the [complete value proposition](docs/product/value-proposition.md) for
the product thesis, responsibility boundaries, and value to each participant.

## From OpenAPI To An Agent Tool

```text
Resource Server
  stable API + OpenAPI + local permission enforcement
                         │
                         ▼
Realmroot
  resource discovery + Agent identity + delegated authorization
                         │
                         ▼
Restish + Realmroot Skill
  generic CLI operations + Agent operating procedure
                         │
                         ▼
Agent
  discover broadly → authorize precisely → call directly
```

Realmroot is not an HTTP proxy and does not replace the resource server's
authorization logic. The resource server advertises its scopes through RFC 9728,
may map them to operations in OpenAPI, and makes the final allow-or-deny decision. Realmroot
recognizes those scopes, obtains controller approval, groups scopes into roles
where useful, and signs the resulting authority into a token or coordinates
issuance with an external authorization server.

This avoids a central permission catalog that can drift away from the API code.
See [ADR 0010](docs/adr/0010-resource-server-owns-business-authorization.md)
for the detailed ownership model.

## Discover Broadly. Authorize Precisely. Call Directly.

An Agent can inspect the resource catalog without receiving business authority.
When it selects an operation, Realmroot derives the requestable scopes from the
resource's live RFC 9728 protected-resource metadata and uses OpenAPI to map
operations to those scopes. A controller reviews the Agent, resource, account,
purpose, exact scopes, and grant lifetime.

Enrollment establishes identity, not authority. Realmroot keeps two approval
boundaries independent:

- **Realmroot management capabilities** let an Agent operate specific resources
  in Realmroot's own Resource API.
- **Resource access approvals** let an Agent call one provider-owned Resource
  through a Resource Server with an exact scope set.

The controller's browser session decides the request but never becomes the
Agent's CLI principal. Roles can group scopes and constrain eligibility; they do
not create implicit access. One-time, limited, persistent, expired, and revoked
grants retain explicit lifecycle semantics and audit context.

## Stable Agent Identity And Delegated Access

An Agent enrolls once and receives an immutable `(issuer, subject)` identity.
That identity is separate from its Hosts, runtime sessions, API profiles, and
keys. A controller can bind a replacement Host or revoke one compromised Host
without changing the Agent subject or affecting its other Hosts.

Resource servers see the stable Agent in the RFC 8693 `act` claim rather than
the runtime installation that presented it. Public Agent profiles provide
cacheable display metadata only; they never participate in authorization.

Realmroot supports two resource boundaries with the same request, approval,
revocation, and audit model:

| | Native Resource Server | External Resource Server |
| --- | --- | --- |
| Token issuer | Realmroot | Target platform |
| User resource | Realmroot user or organization home space | Connected target account |
| User refresh credential exposed to Agent | Never | Never |
| Final credential | Five-minute Realmroot `at+jwt` | Short-lived target DPoP token |
| Subject | Personal owner or organization home space | Connected target user |
| Actor | Stable Agent | Stable Agent |

For native resources, the API trusts Realmroot's issuer and JWKS. For external
resources, the target retains its users, OAuth server, tokens, and consent.
Realmroot protects the connected user's refresh credential and uses standard
PKCE, JWT bearer, token exchange, and DPoP flows to obtain narrowly delegated
access.

For each Resource credential, the Restish adapter creates a separate P-256 DPoP key,
stores the short-lived token in protected local state, and removes the raw token
from command output. The Agent then calls the resource URL directly. The
resource server validates issuer, audience, scope, expiry, key binding, request
proof, and replay protection.

The [Agent access guide](docs/guides/agent-access.md) and
[Agent identity architecture](docs/architecture/agent-identity.md) describe the
complete lifecycle and trust model.

## What A Resource Server Needs To Do

To make an API available to Agents, a resource server owns only its normal API
contract and authorization boundary:

1. Maintain a stable protected resource URL.
2. Publish its requestable scopes in RFC 9728 protected-resource metadata.
3. Advertise an OpenAPI 3.x document from that URL with an RFC 8631
   `service-desc` link.
4. Optionally map operations to advertised scopes with standard OpenAPI security requirements.
5. Validate the issued token and enforce permissions locally.
6. Register the resource in Realmroot as `native` or `external`.

Choose `native` when the API trusts Realmroot as its authorization server.
Choose `external` when the target owns its users and OAuth server. There is no
Agent-specific endpoint or per-runtime adapter to maintain.

The normative standards and extension inventory is the
[Agent-native Resource Server Profile](docs/integrations/agent-native-resource-server-profile.md).
The implementation and validation checklist is in
[Resource server integration](docs/integrations/resource-servers.md). Runnable
[native](examples/native-resource-server/README.md) and
[external](examples/external-resource-server/README.md) examples implement both
modes end to end.

## Agent Skills

The `realmroot/realmroot` repository publishes focused Skills for three
Realmroot jobs. Each installed name includes `realmroot` because Skills share a
global namespace even though their GitHub source is already namespaced by the
Realmroot organization and repository.

| Skill | Use it for |
| --- | --- |
| `realmroot` | Establish a stable Agent identity, discover Resources, obtain access, call private capabilities, and administer Realmroot. |
| `integrate-realmroot-application` | Integrate browser, native, CLI, or server applications with Realmroot OAuth and OIDC. |
| `integrate-realmroot-resource-server` | Assess and implement the required, conditional, and recommended capabilities for an existing protected API to join Realmroot. |

The Resource Server Skill assumes that the provider already owns its business
resource model, routes, representations, and scope vocabulary. This repository
defines Realmroot integration requirements; it does not maintain general API
design guidance.

List the Skills available from the repository without installing them:

```bash
npx skills add realmroot/realmroot --list
```

### Install

Install only stable Agent identity and private capability access:

```bash
npx skills add realmroot/realmroot -g --agent codex -y --skill realmroot
```

Install the application-development pair:

```bash
npx skills add realmroot/realmroot -g --agent codex -y \
  --skill realmroot integrate-realmroot-application
```

Install the Resource Server development set:

```bash
npx skills add realmroot/realmroot -g --agent codex -y \
  --skill realmroot integrate-realmroot-resource-server
```

Install every Skill in this repository:

```bash
npx skills add realmroot/realmroot -g --agent codex -y --skill '*'
```

Verify the installed names, source, and scope:

```bash
npx skills list -g --agent codex
```

### Update

Update all globally installed Skills from their recorded sources:

```bash
npx skills update -g -y
```

Or update only the Realmroot Skills used by a particular workflow:

```bash
npx skills update -g -y realmroot integrate-realmroot-application
npx skills update -g -y realmroot integrate-realmroot-resource-server
```

The Skill package and Restish adapter update independently. After a Skill
update that changes the Agent protocol or credential workflow, follow
[Deployment upgrades](docs/deploy/upgrades.md#agent-client-compatibility) and
verify the installed Restish adapter version.

### Invoke

Give the Agent the product goal rather than an enrollment subtask:

```text
Use $realmroot to discover and call the private API capability needed for this task.
```

For product integrations, explicitly select the development Skill when useful:

```text
Use $integrate-realmroot-application to connect this application to Realmroot and verify sign-in end to end.

Use $integrate-realmroot-resource-server to expose this API through Realmroot and prove a real Agent operation.
```

On the first protected operation, the Restish adapter opens a hosted enrollment
or approval page. Once the controller approves, the original operation resumes
as the Agent. Discovery, authorization, and token issuance are intermediate
steps; completing the requested resource operation is the result.

The exact setup and Agent operating procedure lives in
[`skills/realmroot`](skills/realmroot/SKILL.md). Application integration lives
in [`skills/integrate-realmroot-application`](skills/integrate-realmroot-application/SKILL.md), and
Resource Server implementation lives in
[`skills/integrate-realmroot-resource-server`](skills/integrate-realmroot-resource-server/SKILL.md).

## Identity Infrastructure For Products

Realmroot can be deployed as the identity root for applications even before
they add Agent capabilities:

- hosted authentication, consent, recovery, MFA, passkeys, and sessions;
- one Better Auth OIDC issuer and user pool;
- public, native, and confidential application clients;
- Account Center for profile, credentials, sessions, linked accounts,
  authorized apps, and personal Agents;
- Admin Console for applications, users, organizations, roles, connectors,
  Resource Servers, security, branding, webhooks, Agents, and audit;
- one OpenAPI-described Resource API for administration and automation.

Applications discover the issuer at:

```text
/api/auth/.well-known/openid-configuration
```

The administrative Resource API contract is served at:

```text
/api/openapi.json
```

Product applications use OIDC for sign-in. They do not call the Resource API
for normal login or session integration.

## Architecture And Deployment

Realmroot runs Better Auth inside a Cloudflare Worker. Hono exposes the HTTP
surface, Drizzle owns the Cloudflare D1 schema, encrypted credential material
stays behind server-side adapters, and React provides the hosted Account Center
and Admin Console.

One deployment is one realm: one issuer, user pool, Agent namespace, policy
boundary, and administrative control plane. Deploy another instance when a
product needs separate users, administrators, issuer URLs, or sign-in policy.

To deploy a realm:

1. Fork `saltbo/realmroot`.
2. Install [`deploy/realmroot-fork.yml`](deploy/realmroot-fork.yml) as
   `.github/workflows/deploy.yml` and enable GitHub Actions.
3. Configure the Cloudflare secrets and sender described in
   [Cloudflare deployment](docs/deploy/cloudflare.md).
4. Run **Deploy Realmroot Fork**, open the deployed URL, and complete first-admin
   onboarding.

Later upgrades use **Sync fork**. The pushed fork commit is the exact version
deployed by the workflow. See [Deployment upgrades](docs/deploy/upgrades.md),
[Fresh deployment setup](docs/deploy/setup.md), and
[ADR 0002](docs/adr/0002-one-deployment-is-one-realm.md) for the isolation decision.

## Documentation

- [Value proposition](docs/product/value-proposition.md): why Realmroot combines
  an Agent tool plane with identity and trust infrastructure.
- [Agent access guide](docs/guides/agent-access.md): the product-level identity,
  approval, account connection, token, and revocation journey.
- [Agent identity architecture](docs/architecture/agent-identity.md): stable
  identity, Host bindings, authority, credentials, public profiles, and audit.
- [Authorization boundary decision](docs/adr/0010-resource-server-owns-business-authorization.md):
  resource-owned scopes, role semantics, issuance policy, and enforcement.
- [Provider Adapter boundary](docs/adr/0004-provider-compatibility-through-external-adapters.md):
  the mandatory separation between Realmroot core and compatibility Adapters.
- [Resource server integration](docs/integrations/resource-servers.md): publish
  and validate native or external protected APIs.
- [Resource API](docs/api/resource-api.md): Realmroot's administrative API and
  Agent capability model.
- [Technical documentation index](docs/README.md): all architecture,
  integration, and deployment documents.
