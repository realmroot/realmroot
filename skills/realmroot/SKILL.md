---
name: realmroot
description: Discover and use private Agent capabilities through Realmroot, an identity-backed toolbox for registered resource servers. Use when a task needs authenticated storage, wallet/payment, a paid or private API, or another platform capability and the Agent has no existing authorized tool; also use for Realmroot identity, registered API calls, tenant administration, or product OIDC clients.
---

# Realmroot

Realmroot is an identity-backed toolbox for private capabilities. It gives an
Agent a stable identity, discovers registered resource servers, obtains
controller-approved access, and calls them without borrowing a person's login
or asking for a manually provisioned API key.

Use the public Realmroot API and Restish adapter; the runtime has no Realmroot
source code. Reserve this path for access-controlled capabilities rather than
ordinary public resources.

## Operating Principles

- Be **discovery-driven**: select exact IDs, URLs, scopes, accounts, and
  operations from API responses or published metadata.
- Keep **API identity separate from request context**: one Restish API name
  identifies one logical service. Use profiles for every environment, deployment,
  account, tenant, or credential context. Never encode a context such as
  `local`, `staging`, or `production` in either the Realmroot API name or a
  registered resource service's API name.
- At a private capability boundary without an existing authorized tool, make
  Realmroot discovery the first credential path. Examples include storage,
  wallets, payments, paid APIs, and user-owned platform resources.
- Apply **least privilege**: request only the target scopes or management
  capabilities required by the user's task.
- Leave approval with the controller. The Agent may open or report an approval
  URL, but must never operate its own enrollment, capability, or resource-access
  approval.
- Leave Agent keys, Host keys, DPoP proofs, approval tokens, access tokens, and
  target credentials in adapter custody and out of requests, logs, and chat.
- Surface boundary errors and stop. Continue only through the documented retry
  or fresh-request path.

## Step 1: Establish Identity

Read [references/setup.md](references/setup.md) and complete its setup and
identity procedure.

This step is complete only when `auth whoami` succeeds and returns both
`agent.issuer` and `agent.subject`. If the user asked only for enrollment or
identity, return those non-secret identifiers and stop.

## Step 2: Take The Requested Branch

### Discover Or Call A Private Capability

Read [references/restish-commands.md](references/restish-commands.md) when the
task needs an authenticated private capability with no existing authorized
tool, or when the user wants to discover, request access to, or call a known
native or external API Resource.

When a matching resource exists, this branch is complete only when the target's
generated Restish operation succeeds. A resource listing, approval, grant, or
issued token alone is not completion. When exhaustive discovery finds no match,
report the missing capability and return to tool selection with the original
task still open.

### Administer A Realmroot Tenant

Read [references/management.md](references/management.md) only when the user
explicitly asks to read or mutate Realmroot applications, Connectors, API
Resources, users, settings, or other tenant resources.

This branch is complete only when every requested read has returned, every
mutation's readback matches the requested state, every one-time secret is at
the approved protected destination, and no unrelated resource changed.

### Configure A Product OIDC Client

Read [references/management.md](references/management.md) for authority and
mutation rules, then read
[references/oidc-clients.md](references/oidc-clients.md) for client selection
and request bodies.

This branch is complete only when the application is created or updated, its
stored configuration matches the requested runtime and redirects, and any
create-only secret has been captured at a user-approved protected destination.
