---
name: realmroot
description: Use Realmroot as the Agent's identity to discover available services, request the permissions needed for a task, call service operations, or run supported native tools such as git, gh, and wrangler. Use whenever a task needs private data, an authenticated service, controller approval, or Realmroot administration.
---

# Use Realmroot

Use the `realmroot` command to complete the user's requested operation as the
Agent. Do not borrow the user's login or ask for an API key.

## 1. Confirm Identity

Read [references/setup.md](references/setup.md) and confirm the Agent identity.

## 2. Discover And Use A Service

Read [references/toolbox-commands.md](references/toolbox-commands.md). Discover
the available Resource Servers, inspect the operation needed for the task,
request its exact scopes, and execute it.

If the selected server is `platform`, also read
[references/management.md](references/management.md).

If an operation requires an x402 payment, also read
[references/x402.md](references/x402.md).

Do not stop after discovery or approval. The task is complete only when the
requested service operation or native command succeeds. After changing a
Resource, read it again when possible to verify the result.
