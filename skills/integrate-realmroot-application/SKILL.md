---
name: integrate-realmroot-application
description: Integrate a browser, mobile, desktop, CLI, or server-side application with Realmroot as its OAuth 2.1 and OpenID Connect provider. Use when building or changing product sign-in, callback, session, refresh, logout, device authorization, PKCE, client-secret handling, or end-to-end authentication against a Realmroot deployment.
---

# Realmroot Application

Integrate the product through Realmroot's standard OAuth and OpenID Connect
surface. Treat application registration and application code as one acceptance
journey, while keeping their security boundaries separate.

## Step 1: Inspect The Product

Read the repository instructions, runtime, existing authentication code,
routing, session storage, deployment environments, and tests. Preserve the
project's framework and authentication-library patterns when they support the
required standards.

Read [references/oidc-runtime.md](references/oidc-runtime.md) and select exactly
one client type and grant set from the actual runtime. Do not choose a
confidential client merely because the product has a backend; only a component
that can protect a secret may authenticate as one.

This step is complete when the runtime, callback owner, client type, grants,
redirect URIs, logout behavior, and secret boundary are explicit.

## Step 2: Configure The Realmroot Application

Use `$realmroot` for deployment selection, Agent identity, management access,
and Application reads or mutations. Require that Skill to be installed; do not
reproduce its enrollment, approval, credential, or Restish procedures here.

Read
[references/application-registration.md](references/application-registration.md)
and the live Realmroot Application operation before mutation. Reuse the
existing Application when it represents the same product and environment.
Otherwise create one client matching the selected runtime. Configure exact
redirect URIs and grants, and route any create-only secret directly to a
user-approved protected destination.

This step is complete when the stored Application representation matches the
selected runtime and every application environment has an intentional redirect
URI.

## Step 3: Implement The Protocol Flow

Use issuer discovery rather than copied endpoint URLs. Prefer the project's
maintained standards-compliant OAuth or OIDC library over hand-written protocol
requests. Implement the selected flow and the validation, storage, refresh,
logout, and error behavior in
[references/oidc-runtime.md](references/oidc-runtime.md).

Keep create or edit forms out of primary browsing pages according to the host
project's UI rules. Surface recoverable authentication failures at the product
boundary instead of silently falling back to another authentication mode.

This step is complete when the product can start authorization, bind and
validate the callback, establish its own local session, and deliberately end or
refresh that session as required.

## Step 4: Verify The Product Journey

Use the repository's narrowest meaningful automated checks. Then verify the
real journey in the selected environment:

1. start sign-in from the product;
2. authenticate and consent through Realmroot;
3. return only to the registered redirect URI;
4. validate the response and create the product session;
5. load a protected product surface;
6. verify refresh or reauthentication behavior when applicable;
7. sign out and confirm the intended local and provider session behavior.

For user-facing changes, document the review-environment URL, required setup,
test identity or seed state, and exact acceptance journey.

The integration is complete only when the configured Realmroot Application,
implemented runtime behavior, automated checks, and real end-to-end journey all
agree.
