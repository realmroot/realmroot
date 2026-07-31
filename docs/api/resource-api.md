# Resource API

Realmroot exposes one resource-oriented API below `/api`. A resource has one
canonical path; administrative browser requests and Agent requests do not use
separate route trees.

Product applications do not use this API for sign-in or session integration.
They consume Realmroot through its OAuth/OIDC issuer below `/api/auth`.

## Contract Discovery

The public OpenAPI 3.1 contract is served at:

```text
/api/openapi.json
```

Protected API responses advertise it with standard links:

```text
Link: </api/openapi.json>; rel="service-desc"; type="application/openapi+json",
      </api/openapi.json>; rel="describedby"; type="application/openapi+json"
```

The generated contract is authoritative for resource paths, operation IDs,
request and response schemas, and security requirements. Prose documentation
describes only conventions that apply across operations.

## Restish Command Surface

Restish uses generic API-relative HTTP commands for routine single-request
operations:

```bash
restish get realmroot/applications
restish post realmroot/applications < application.json
restish patch realmroot/applications/app_123 'name: Updated'
restish delete realmroot/applications/app_123
```

Discover the complete generic operation surface, including HTTP methods,
resource paths, and operation IDs, with:

```bash
restish doctor api realmroot
```

Generated commands are reserved for Agent identity, controller approval, and
target credential workflows that span more than an ordinary resource request.
With Restish tag layout enabled, the complete generated surface is:

```text
auth whoami
capability request
access request
access token <grant-id>
```

The Agent-facing product model uses Agents, enrollments, API Resources, account
connections, access requests, access grants, and audit events. Protocol
registrations, Hosts, identity bindings, OAuth connection intents, client
integration records, refresh credentials, and token leases remain internal
security records rather than additional public resources.

## Authentication And Authorization

Protected operations accept either:

- an authenticated administrator browser session; or
- an AgentAuth proof bound to an enrolled, active Agent identity.

Authentication establishes the principal. Authorization is evaluated
separately:

- browser principals require the applicable administrator authority;
- Agent principals require the exact operation capability published by the
  OpenAPI operation.

Read operations conventionally require `{resource}:read`; mutations require
`{resource}:write`; read-only resources expose no write capability. Missing or
invalid authentication returns `401`, while an authenticated principal without
the required authority receives `403`.

The Agent enrollment and capability approval procedure belongs to the
Realmroot skill and is intentionally not duplicated here.

Management capabilities authorize this Resource API only. Access requests and
grants authorize exact scopes on a protected business API and never imply a
Realmroot management capability. The two approval systems share the stable
Agent principal but do not exchange authority.

## Errors

API errors use one JSON envelope:

```json
{
  "error": {
    "code": "bad_request",
    "message": "Invalid request.",
    "requestId": "request-id"
  }
}
```

`code` is one of `bad_request`, `unauthorized`, `forbidden`, `not_found`,
`conflict`, `resource_in_use`, `bad_gateway`, or `internal_error`. `details` is
present only when the caller needs structured conflict or upstream-boundary
context.

## Pagination

Collection endpoints accept:

- `limit`: integer from 1 to 100;
- `offset`: non-negative integer.

Collection responses include:

```json
{
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 42,
    "hasMore": true,
    "nextOffset": 20
  }
}
```

`nextOffset` is `null` when there is no next page.

## Resource Conventions

Resources use nouns, standard HTTP methods, and explicit child-resource paths.
Collection mutations that replace a complete set use `PUT`; partial resource
updates use `PATCH`. Secret material is returned only at creation or rotation
boundaries and is absent from later reads.

API Resources identify protected business APIs. Their target OpenAPI documents
are authoritative for available scope strings and operation requirements;
Realmroot roles reference those strings rather than defining another scope
catalog.

Asset uploads use `multipart/form-data` with a single `file` field. Assets are
stored in the private R2 bucket and returned through same-origin
`/api/assets/{assetId}` URLs.

## Contract Ownership

Route definitions and shared Zod schemas generate the maintained OpenAPI
document. Contract tests compare the mounted route table with that document so
an operation cannot be added without being represented in discovery.
