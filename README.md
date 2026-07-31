<p align="center">
  <img src="assets/logo.png" alt="Realmroot logo" width="132" height="132" />
</p>

<h1 align="center">Realmroot</h1>

<p align="center">
  Stable identity and delegated access for AI Agents.
</p>

<p align="center">
  Give every Agent a durable identity. Let users approve exactly what it can
  access. Keep user credentials out of Agent hands.
</p>

<p align="center">
  <a href="https://github.com/saltbo/realmroot/actions/workflows/ci.yaml"><img src="https://github.com/saltbo/realmroot/actions/workflows/ci.yaml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/saltbo/realmroot.svg" alt="License" /></a>
  <a href="https://codecov.io/gh/saltbo/realmroot"><img src="https://codecov.io/gh/saltbo/realmroot/branch/main/graph/badge.svg" alt="Coverage" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D24-339933.svg" alt="Node >=24" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/TypeScript-6.x-3178c6.svg" alt="TypeScript 6.x" /></a>
</p>

## The Agent Identity Problem

An Agent is not a browser session, a machine, or a private key. Runtimes restart,
Hosts are replaced, keys rotate, and the same Agent may operate from more than
one Host. If identity is tied to any of those details, the Agent either loses
continuity or silently carries authority somewhere it should not.

Giving the Agent a user's API key is not a solution either. It collapses the
user and Agent into one principal, grants more authority than the task needs,
cannot express who approved the action, and makes safe revocation difficult.
External services add another boundary: they own their users, OAuth servers,
tokens, and consent.

Realmroot solves these as one identity and delegated-access system:

- the Agent has its own stable identity;
- a person or organization controls that identity;
- authority is requested for an exact resource and scope set;
- the controller approves the request without becoming the Agent;
- credentials remain with Realmroot and the local protocol adapter;
- the Agent calls the resource directly with a short-lived, proof-of-possession
  token;
- every decision and revocation retains the Agent, Host, controller, resource,
  scopes, and outcome as audit context.

## A Stable Identity For Every Agent

An Agent enrolls once and receives an immutable `(issuer, subject)` identity
from the realm's existing OIDC issuer. It belongs to exactly one personal or
organization home space, whose users govern it.

The stable Agent is deliberately separate from its execution credentials:

| Concept | Responsibility |
| --- | --- |
| Agent | Durable product identity presented to resource servers. |
| Host registration | Authenticates one runtime installation and its local keys. |
| Identity binding | Allows that Host to act as the stable Agent. |
| Controller | Approves enrollment and authority from a normal user session. |
| Home space | Defines whether the Agent and connected resources belong to a person or organization. |

Restish API names, profiles, runtime sessions, and key rotation do not define a
new Agent. A controller can bind replacement or additional independently
secured Hosts to the same identity without sharing private keys. Revoking one
Host leaves the stable identity and its other Hosts intact. Recovery preserves
the subject while revoking current bindings and resource authority; retirement
reserves the subject permanently for historical audit.

Resource servers see the stable Agent in the RFC 8693 `act` claim, not the Host
that happened to present it. They can resolve its public name and picture from
the issuer's cacheable AgentInfo endpoint. AgentInfo is display metadata only
and never participates in authorization.

## Give Agents Authority Without Giving Away User Credentials

Enrollment establishes identity, not authority. Realmroot keeps two approval
boundaries independent:

- **Realmroot management capabilities** allow an Agent to operate specific
  resources in Realmroot's own Resource API.
- **API Resource grants** allow an Agent to call one protected business API with
  an exact OpenAPI scope set.

For a business operation, the Agent discovers registered API Resources,
inspects the target's OpenAPI contract, and requests only the scopes declared by
the selected operation. A controller reviews the Agent, resource, account,
reason, exact scopes, and grant lifetime. The resulting grant is one-time,
limited, or persistent. Changing the resource, account, or scope set requires a
new decision.

The controller's browser session only decides the request. CLI operations
continue as the stable Agent and never adopt or impersonate the approving user.
Roles may restrict which resource scopes an Agent is eligible to request, but
roles and enrollment never create implicit access.

## Access User Resources Safely

Realmroot supports two authorization boundaries with the same Agent request,
grant, revocation, and audit model:

| | Native API Resource | External API Resource |
| --- | --- | --- |
| Token issuer | Realmroot | The target platform |
| User resource | Realmroot user or organization home space | One connected target account in that home space |
| User refresh credential exposed to Agent | Never | Never |
| Adapter-held final token | Realmroot-signed, five-minute `at+jwt` | Short-lived target-issued DPoP token |
| Subject | Personal owner or organization home space | Connected target user |
| Actor | Stable Agent | Stable Agent |

### Native Resources

A product API trusts the Realmroot issuer and JWKS. Once a controller approves
the Agent's exact scopes, Realmroot issues an audience-bound token containing
the home-space subject, stable Agent actor, approved scopes, effective roles,
organization group when applicable, and DPoP key thumbprint.

### External Resources

The target platform keeps its own users and authorization server. A controller
connects one target account to the Agent's personal or organization home space
with authorization code and S256 PKCE. Realmroot encrypts the refresh credential
and never exposes it to the Agent, APIs, audit events, or errors.

When access is approved, Realmroot refreshes the connected user's subject token,
obtains a stable-Agent actor token with the RFC 7523 JWT bearer grant, and uses
RFC 8693 token exchange to obtain the final target-issued token. The target
intersects user authority with the Agent's approved scopes. If the connected
account lacks a required scope, the controller must expand the account
authorization before separately approving the Agent request.

## Direct, DPoP-Bound Access

Realmroot is not an HTTP proxy and has no credential-injection egress endpoint.
For the current grant on each API Resource, the Restish adapter creates a
separate P-256 DPoP key, keeps the short-lived token in protected local state,
and removes the raw token from command output.

The Agent calls the resource URL directly:

```text
Agent -> Realmroot: approved grant + token-endpoint DPoP proof
Realmroot -> target authorization server: subject/actor exchange (external only)
Realmroot -> Agent adapter: short-lived DPoP token
Agent adapter -> Resource API: Authorization: DPoP ... + fresh request proof
Resource API: validate issuer, audience, scope, expiry, key binding, ath, and replay
```

A newly approved grant for the same resource replaces the obsolete local grant
binding and DPoP key. Persistent and limited grants can refresh short-lived
tokens while active. One-time, expired, revoked, or otherwise inactive grants
cannot silently regain access.

## Security Properties

- **Identity is not a credential.** Agent identity survives legitimate Host and
  key changes; credentials remain independently revocable.
- **Approval does not impersonate.** The controller authorizes the Agent but
  never becomes its CLI principal.
- **OpenAPI scopes are authoritative.** Realmroot does not maintain a second,
  drifting business-scope catalog.
- **Discovery fails safely.** One unavailable API does not hide healthy
  resources, but it exposes no requestable scopes and cannot issue a token.
- **User refresh credentials never reach the Agent.** They are encrypted with
  purpose-specific envelopes inside Realmroot.
- **Tokens are audience-restricted, short-lived, and DPoP-bound.** Resource
  servers validate both the token and a fresh proof for every request.
- **Business traffic is direct.** Realmroot authorizes access but never proxies
  the protected API call.
- **Revocation is scoped.** A Host, grant, account connection, credential, or
  Agent can be revoked without disturbing unrelated Agents and resources.
- **Audit excludes secrets.** Decisions retain useful identity and authority
  context without tokens, authorization headers, or full payloads.

## Quick Start For Agents

Install the Realmroot skill globally for the Agent runtime that should use it:

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

Then give the Agent a goal:

```text
Use Realmroot to add identity and delegated Agent access to this project.
```

On the first protected operation, the skill connects Realmroot's OpenAPI
contract and the Restish adapter opens a hosted enrollment page. The controller
approves once; the original operation resumes as the Agent. For a private API
task, the Agent discovers the resource, inspects its contract, requests the
least-privilege scopes, waits for approval, obtains a protected credential, and
invokes the target operation. Discovery, approval, and token issuance are
intermediate steps—the requested resource operation is the result.

The exact setup and operating procedure lives in
[`skills/realmroot`](skills/realmroot/SKILL.md).
The skill and Restish adapter update independently; follow
[Deployment upgrades](docs/deploy/upgrades.md#agent-client-compatibility) when
the Agent protocol or resource-authorization model changes.

## Make An API Available To Agents

An API Resource has one protected resource URL. An unauthenticated request to
that exact URL advertises an OpenAPI 3.x document through an RFC 8631
`service-desc` link. Protected operations declare their OAuth or OIDC scopes in
standard OpenAPI security requirements.

Choose `native` when the API trusts Realmroot as its authorization server.
Choose `external` when the target owns its users and OAuth server. External
integration uses standard protected-resource and authorization-server metadata,
PKCE, refresh tokens, JWT bearer assertions, token exchange, DPoP, UserInfo,
dynamic or configured OAuth clients, and revocation.

The complete protocol and validation checklist is in
[Resource server integration](docs/integrations/resource-servers.md). Runnable
[native](examples/native-resource-server/README.md) and
[external](examples/external-resource-server/README.md) examples implement both
modes end to end.

To design or review a resource-oriented OpenAPI contract, install the companion
skill:

```bash
npx skills add realmroot/realmroot -g --skill design-resource-api
```

Then invoke it with the API requirements or existing OpenAPI contract:

```text
Use $design-resource-api to model this API as resources, produce its OpenAPI
contract, and justify any exceptional generated commands.
```

## Human Identity And Application OIDC

The same deployment is a complete identity root for the people who control
Agents and the applications they use:

- hosted sign-in, sign-up, recovery, consent, MFA, passkeys, and sessions;
- one user pool and Better Auth OIDC issuer;
- public, native, and confidential application clients;
- Account Center for profile, credentials, linked accounts, authorized apps,
  and personal Agents;
- Admin Console for applications, users, organizations, roles, connectors,
  API Resources, security policy, branding, webhooks, Agents, and audit;
- a unified, OpenAPI-described Resource API for administration and automation.

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
[Tenancy](docs/architecture/tenancy.md) for operational details.

## Documentation

- [Agent access guide](docs/guides/agent-access.md): the product-level identity,
  approval, account connection, token, and revocation journey.
- [Agent identity architecture](docs/architecture/agent-identity.md): stable
  identity, Host bindings, authority, credential, AgentInfo, and audit boundaries.
- [Resource server integration](docs/integrations/resource-servers.md): publish
  and validate native or external protected APIs.
- [Resource API](docs/api/resource-api.md): Realmroot's administrative API and
  Agent capability model.
- [Auth provider architecture](docs/architecture/auth-provider.md): issuer,
  clients, claims, and workload token exchange.
- [Technical documentation index](docs/README.md): all architecture,
  integration, and deployment documents.
