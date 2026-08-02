---
name: design-resource-api
description: Design or review resource-oriented HTTP APIs whose routine operations work through generic HTTP and Restish commands. Use when defining resources, canonical URIs, methods, status codes, OpenAPI contracts, authorization scopes, or deciding whether an exceptional workflow warrants a generated command.
---

# Design Resource APIs

Design the API as a resource model. A successful design lets clients perform
routine operations with standard HTTP methods and generic Restish commands.
Reserve dedicated commands for workflows that require client-side orchestration
beyond one ordinary resource request.

## Non-Negotiable Principle: Resources Before APIs

Never translate a product requirement, page, tab, button, form, or business
action directly into an endpoint. Product behavior is evidence for discovering
the domain model; it is not the API model.

Use this decision order without skipping a step:

```text
product capability
  -> domain concepts
  -> resource boundaries
  -> identity, ownership, state, and lifecycle
  -> canonical URI and representation
  -> HTTP methods and contract
  -> product composition
```

Before adding an operation, first identify the resource or collection it acts
on and prove that the resource has stable domain meaning independent of the
current UI or workflow. Define its identity, ownership, representation,
lifecycle, and state transitions. If those cannot be defined, do not add the
API. Revisit the domain model or compose the product behavior from existing
resources instead.

A resource does not need to map one-to-one to a database table. It does need to
be a coherent backend abstraction. Derived, aggregate, policy, request, job,
attempt, and result resources are valid only when clients can recognize them as
stable domain concepts with their own contract. A response assembled solely to
populate one screen is not a resource.

## Step 1: Establish The Boundary

Read the repository instructions, existing routes, schemas, specifications, and
API conventions before proposing a change. Identify the callers, authorization
boundary, compatibility constraints, and whether the task is a new design or a
review of an existing contract.

For changed product behavior, update the repository's behavior specification
before implementation when its workflow requires that.

This step is complete when the design boundary and every affected existing
operation are accounted for.

## Step 2: Model Resources

Treat requested capabilities as use cases to analyze, not endpoints to
implement. Identify resources, collections, singleton resources, child
resources, jobs, requests, attempts, results, policies, or other stable domain
concepts that exist independently of the product surface. Give every resource
one canonical URI within a caller boundary. Represent a business transition as
creating, replacing, updating, or deleting a resource rather than placing an
action verb in the URI.

For every candidate resource, record:

- its domain meaning and why it exists independently of a page or feature;
- its stable identity and canonical URI;
- its owner and authorization boundary;
- its representation and server-managed fields;
- its creation, update, transition, retention, and deletion lifecycle;
- its relationship to existing resources and whether one already represents
  the same concept.

Do not design paths, methods, schemas, or operation IDs until this inventory is
coherent. A product capability may require several ordinary resource
operations; several product capabilities may use the same resource. Do not
force a one-to-one mapping in either direction.

Read [references/resource-design.md](references/resource-design.md) while
building or reviewing the resource model. Read
[references/dataset-export-example.md](references/dataset-export-example.md)
when an independent end-to-end example would clarify the design.

This step is complete when every requested capability is composed from
resource representations or state transitions, every resource passes the
abstraction test above and has one canonical URI, duplicate concepts have been
removed, and no UI-shaped or RPC-style endpoint remains.

## Step 3: Define The HTTP Contract

Assign standard methods according to their semantics. Define representations,
request media types, success and error statuses, validation boundaries,
pagination, conditional requests, idempotency, and asynchronous lifecycle
behavior. Keep authorization differences in security requirements rather than
duplicating resource trees for different principals.

This step is complete when every operation has explicit request, success,
failure, concurrency, retry, and authorization behavior where applicable.

## Step 4: Publish OpenAPI

Produce or update an OpenAPI 3.1 contract containing every operation and its
stable unique `operationId`, parameters, request bodies, response bodies,
headers, errors, security requirements, schemas, and useful examples. Protected
operations declare exact OAuth or OpenID Connect scopes through standard
OpenAPI `security` requirements.

When the API will connect to Realmroot, also read
[references/realmroot-restish.md](references/realmroot-restish.md) and apply its
resource discovery and scope rules.

This step is complete when the OpenAPI document describes the entire designed
surface exactly once and a client can discover every operation without prose.

## Step 5: Keep The CLI Generic

Treat generic HTTP commands as the default command surface:

```text
restish get
restish post
restish put
restish patch
restish delete
restish edit
```

Keep routine operations discoverable in OpenAPI while hiding their generated
commands with `x-cli-hidden: true`. Do not create dedicated list, get, create,
update, or delete commands.

Create an exceptional-command whitelist only for workflows that require
client-side orchestration such as browser interaction, waiting across multiple
requests, local credential generation, or protected local storage. A command
name that merely restates one HTTP operation does not qualify. If no workflow
qualifies, return an empty whitelist.

This step is complete when every operation is usable through the generic
surface and every visible dedicated command has a written orchestration reason.

## Step 6: Verify The Contract

Run the repository's narrowest OpenAPI validation and contract tests. When
Restish is available, connect or sync the API, inspect `restish doctor api
<name>`, inspect generic operation authentication, and inspect the visible help
surface. Exercise at least one representative collection read, creation,
update or replacement, deletion, and exceptional workflow when those
operations exist.

Report:

- the resource inventory, abstraction rationale, and canonical URIs;
- how each product capability composes those resources;
- the method, path, and status contract;
- the OpenAPI artifact;
- the exceptional-command whitelist with reasons;
- validation commands and results.

The design is complete only when every requested capability is reachable
through the resource contract, routine operations need no dedicated command,
and all checks pass.
