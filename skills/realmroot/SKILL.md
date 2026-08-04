---
name: realmroot
description: Discover and use private Agent capabilities through Realmroot, an identity-backed toolbox for registered Resource Servers. Use when a task needs an authenticated or paid private API, another registered capability, Realmroot Agent identity and resource access, tenant administration, or product OIDC clients.
---

# Realmroot

Realmroot is an identity-backed toolbox for private capabilities. It gives an
Agent a stable identity, discovers registered resource servers, obtains
controller-approved access, and calls them without borrowing a person's login
or asking for a manually provisioned API key.

## Operating Model

- Be **discovery-driven**: select exact IDs, URLs, scopes, accounts, and
  operations from API responses or published metadata.
- Use one Restish API name per logical service and profiles for deployments,
  accounts, tenants, and credential contexts.
- Apply **least privilege**: request only the OAuth scopes required by the
  user's task and bind them to exactly one Resource.
- Hand every approval decision to the controller. The Agent may open or report
  the approval URL and wait for the original command to finish.
- Keep keys, DPoP proofs, approval tokens, access tokens, and target credentials
  in adapter custody.
- Treat a successful target operation as completion; discovery, approval, and
  credential readiness are intermediate states.

## Step 1: Establish Identity

Read [references/setup.md](references/setup.md) and complete its setup and
identity procedure.

This step is complete only when `whoami` succeeds and returns both
`agent.issuer` and `agent.subject`. If the user asked only for enrollment or
identity, return those non-secret identifiers and stop.

## Step 2: Take The Requested Branch

### Discover Or Call A Private Capability

Read [references/restish-commands.md](references/restish-commands.md) when the
task needs an authenticated private capability with no existing authorized
tool, or when the user wants to discover, request access to, or call a known
native or external Resource Server.

For an x402-paid operation, also read
[references/x402.md](references/x402.md) before obtaining the payment
challenge.

When a matching resource exists, this branch is complete only when the target's
generated Restish operation succeeds. When exhaustive discovery finds no match,
report the missing capability with the original task still open.

### Administer A Realmroot Tenant

Read [references/management.md](references/management.md) only when the user
explicitly asks to read or mutate Realmroot applications, Connectors, Resource
Servers, users, settings, or other tenant resources.

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
