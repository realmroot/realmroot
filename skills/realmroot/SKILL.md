---
name: realmroot
description: Operate Realmroot through Restish with discovery-driven, least-privilege access. Use when establishing a Realmroot Agent identity, calling a registered API Resource, administering a Realmroot tenant, or configuring a product OIDC client.
---

# Realmroot

Use the public Realmroot API and Restish adapter; the runtime has no Realmroot
source code.

## Operating Principles

- Be **discovery-driven**: select exact IDs, URLs, scopes, accounts, and
  operations from API responses or published metadata.
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

This step is complete only when `get-current-agent` succeeds and returns both
`agent.issuer` and `agent.subject`. If the user asked only for enrollment or
identity, return those non-secret identifiers and stop.

## Step 2: Take The Requested Branch

### Call A Registered API Resource

Read [references/restish-commands.md](references/restish-commands.md) when the
user wants to discover, request access to, or call a registered native or
external API Resource.

This branch is complete only when the target's generated Restish operation
succeeds. A resource listing, approval, grant, or issued token alone is not
completion.

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
