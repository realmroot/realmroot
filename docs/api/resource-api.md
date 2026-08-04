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
The complete generated workflow surface is:

```text
whoami
connect <resource-server-id>
access
```

The plugin separately contributes `restish auth login`, `restish auth logout`,
and `restish auth status`. Login is the only identity-establishing command;
status is a zero-network local inventory. The generated `whoami` operation is a
read-only current-identity query and never initiates login or token refresh.

Resource Server and Resource representations are ordinary HTTP resources and
are read with Restish's generic `get` command. This keeps local configuration
logic out of the Realmroot plugin and avoids turning routine reads into custom
commands.

The Agent-facing product model uses Agents, Resource Servers, provider-owned
Resources, connection requests, access requests, and short-lived credentials.
It exposes connection and scope status without exposing account-connection IDs,
provider authorization details, grants, refresh credentials, or token endpoints.
Those remain internal security records.

## Authentication And Authorization

Protected operations accept either:

- an authenticated browser session; or
- an AgentAuth proof bound to an enrolled, active Agent identity.

Authentication establishes the principal. Authorization is evaluated
separately:

- Realm operators can inspect Realm inventory;
- Organization developers can inspect only inventory owned by Organizations
  available to them in Console;
- Account Center members can inspect only their own effective Role assignments
  and Agent grants owned by their personal or member Organization spaces;
- Agent principals require the exact operation capability published by the
  OpenAPI operation.

Read operations conventionally require `{resource}:read`; mutations require
`{resource}:write`; read-only resources expose no write capability. Missing or
invalid authentication returns `401`, while an authenticated principal without
the required authority receives `403`.

The Agent enrollment procedure belongs to the Realmroot skill and is
intentionally not duplicated here. Realmroot management authority is assigned
by a controller; it is not a generated Agent workflow command.

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
`conflict`, `resource_in_use`, `precondition_failed`,
`precondition_required`, `bad_gateway`, or `internal_error`. `details` is
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

`/application-authorizations`, `/role-assignments`,
`/agent-access-requests`, and `/agent-access-grants` are canonical Realm
inventories. Their relationship fields are optional filters: omitting
`applicationId`, `agentId`, `organizationId`, or `resourceId` lists every
record visible to the authenticated principal. A filter never establishes
ownership or expands visibility. Console and Account Center use these same
URIs; there are no product-surface aliases.

## Resource Conventions

Resources use nouns, standard HTTP methods, and explicit child-resource paths.
Collection mutations that replace a complete set use `PUT`; partial resource
updates use `PATCH`. Secret material is returned only at creation or rotation
boundaries and is absent from later reads.

Successful collection creates return `201 Created` with a `Location` header for
the canonical member URI. Durable revocation and archival state is represented
as a subordinate resource and changed idempotently with `PUT` or `DELETE`, not
with action endpoints.

Representations that can be replaced concurrently expose a strong `ETag`.
Clients send that value in `If-Match`; missing and stale preconditions return
`428 Precondition Required` and `412 Precondition Failed`, respectively.

Creating a webhook delivery attempt or Agent installation enrollment requires
`Idempotency-Key`. A webhook attempt key is scoped to its parent delivery
request; an installation enrollment key is scoped to the authenticated protocol
Agent registration. The key is retained with the durable resource. Replaying it
returns the same canonical resource and sets `Idempotency-Replayed: true`.
Reusing an installation enrollment key for another stable Agent returns
`409 Conflict`; retrying a webhook attempt never sends the webhook twice.

Resource Server registrations identify protected business APIs. Their target OpenAPI documents
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
