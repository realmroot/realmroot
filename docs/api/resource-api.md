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

`code` is one of `bad_request`, `unauthorized`, `forbidden`, `not_found`, or
`internal_error`.

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
