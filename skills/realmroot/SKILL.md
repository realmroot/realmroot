---
name: realmroot
description: Use Realmroot as a stable Agent identity to discover, request access to, and operate authenticated or paid private Resources without borrowing a person's login or manually provisioned API key. Use for Agent enrollment or identity, private capability discovery, Resource and scope selection, controller approval, account connection, direct Resource Server operations, x402-paid operations, or explicit Realmroot tenant administration through its Resource API.
---

# Use Realmroot

Complete the user's requested Resource operation as a stable Agent. Treat
identity, discovery, account connection, approval, and credential readiness as
intermediate states.

## Operating Model

- Select exact deployments, Resource Servers, Resources, scopes, accounts, and
  operations only from live responses and published metadata.
- Request the complete task-scoped authority but no unrelated scope.
- Bind every credential to exactly one Resource.
- Hand enrollment, account connection, and access decisions to the controller.
- Keep Agent protocol secrets in the Realmroot adapter and target DPoP keys,
  proofs, tokens, and cache in Restish custody.
- Call the target Resource Server directly; Realmroot does not proxy business
  traffic.

## Step 1: Establish Identity

Read [references/setup.md](references/setup.md) completely and follow its
deployment, Restish, profile, and identity procedure.

This step is complete only when `whoami` returns both `agent.issuer` and
`agent.subject`. If the user requested identity only, return those non-secret
identifiers and stop.

## Step 2: Discover And Operate The Resource

Read [references/restish-commands.md](references/restish-commands.md)
completely. Discover every Resource Server page, select the exact service and
provider-owned Resource from returned metadata, establish any required
controller account connection, inspect the target OpenAPI operation, and
request the union of its required scopes.

When the selected Resource Server has `identifier: realmroot`, also read
[references/management.md](references/management.md) for its authority
boundaries and mutation rules.

When the target returns an x402 payment requirement, also read
[references/x402.md](references/x402.md) before starting the live payment
exchange.

Do not treat a matching Resource Server, connected account, approved request,
or ready credential as completion. Invoke the requested generated target
operation and verify its result. After a mutation, read the affected Resource
back when its contract permits.

If exhaustive discovery finds no matching Resource Server or Resource, report
the missing capability with the original task still open.

The task is complete only when every requested target operation succeeds and no
unrelated Resource changes.
