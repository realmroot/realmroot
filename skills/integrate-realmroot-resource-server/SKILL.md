---
name: integrate-realmroot-resource-server
description: Integrate and assess an existing protected API as a Realmroot Resource Server. Use when determining required, conditional, and recommended integration capabilities; implementing or validating RFC 9728 and OpenAPI discovery; selecting native, external, or brokered authorization; enforcing Realmroot token, audience, scope, actor, or DPoP requirements; registering the Resource Server; or proving end-to-end Agent access. This Skill does not design the business API or its resource model.
---

# Integrate A Realmroot Resource Server

Integrate an existing protected API with Realmroot without redesigning its
business resource model. Treat Realmroot registration as the final publication
step, not as a substitute for a conforming Resource Server.

## Step 1: Establish Existing Inputs

Read the repository instructions, deployed API contract, authorization model,
scope vocabulary, environments, and tests. Identify:

- the stable protected resource URL;
- the existing OpenAPI 3.x document;
- the provider-owned Resources Realmroot will expose;
- the existing requestable scopes and protected operations;
- whether the provider or Realmroot owns authorization.

Do not invent domain Resources, routes, methods, representations, or business
scopes. If any required input is absent or internally inconsistent, report it as
an API-design prerequisite and stop that part of the integration.

This step is complete when the integration can refer to existing canonical API
and authorization decisions.

## Step 2: Select The Authorization Mode

Read [references/integration-requirements.md](references/integration-requirements.md)
completely, then choose one mode:

- use **native** when the API trusts Realmroot as its authorization server;
- use **external** when the provider owns its users, authorization server,
  tokens, and consent;
- add **brokered account connection** only when a native Resource Server must
  retain another provider's credentials behind its own boundary.

Deployment outside Realmroot does not make a Resource Server external.

## Step 3: Assess Conformance

Evaluate every requirement applicable to the selected mode. Report results by
capability ID and classification:

- **REQUIRED**: block registration or enablement until it passes;
- **CONDITIONAL**: block only when the integration selected the condition;
- **RECOMMENDED**: report the operational or product limitation when absent,
  but do not present it as a protocol failure.

Use live metadata, OpenAPI, implementation, and tests as evidence. Do not infer
conformance from prose or planned work.

## Step 4: Implement Missing Integration Capabilities

Implement only the missing Realmroot integration surface identified by the
assessment: discovery metadata, OpenAPI advertisement and security mapping,
authorization-server interoperability, token and DPoP validation, actor
preservation, account connection, revocation, or lifecycle signals.

Keep the business API's existing resources and semantics intact. Update the
metadata, OpenAPI security declarations, enforcement, and tests together when
the integration changes scope exposure or authorization behavior.

This step is complete when every applicable REQUIRED and CONDITIONAL capability
has direct implementation and test evidence.

## Step 5: Register Through Realmroot

Read [references/registration.md](references/registration.md). Use
`$realmroot` for Agent identity, management authority, Connector or Resource
Server mutations, controller account connection, and access requests. Require
that Skill to be installed; do not reproduce its enrollment or credential
procedures.

Register the exact protected resource URL only after its unauthenticated
discovery surface is reachable. Use no Connector for native mode. For external
mode, configure the Connector required by the live Realmroot contract and let
the controller connect the account. Never copy provider tokens into Realmroot
or Restish manually.

Read the created representation back and confirm ownership, mode, availability,
connection state, and discovered scope registry.

## Step 6: Prove End-To-End Access

Run the repository's narrowest conformance and integration checks, then use
`$realmroot` as a real Agent to:

1. discover the registered Resource Server;
2. discover and select a provider-owned Resource;
3. request the exact scopes required by one existing operation;
4. connect the target OpenAPI contract through Restish;
5. invoke one real read operation;
6. invoke and read back one safe write when the existing API exposes one.

Report the final capability matrix, remaining RECOMMENDED gaps, automated
checks, and real operation evidence. The integration is complete only when all
applicable REQUIRED and CONDITIONAL capabilities pass and direct target API
traffic succeeds with the expected identity, audience, scope, actor, DPoP
binding, and local authorization result.
