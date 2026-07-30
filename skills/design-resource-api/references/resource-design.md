# Resource Design Reference

Use this reference while creating or reviewing the resource model and HTTP
contract.

## Resource Model

- Name URIs after resources, not controller methods or commands.
- Use plural collection names consistently.
- Give a resource one canonical URI within a caller boundary.
- Nest a resource only when the parent owns or uniquely identifies it.
- Model settings, policies, status, locks, bans, results, requests, approvals,
  attempts, and jobs as resources when they have independent state or
  lifecycle.
- Express the same resource through the same URI for different principals.
  Put principal-specific authority in OpenAPI security requirements.
- Keep implementation records private when callers act on a more stable product
  aggregate.

Before accepting an action-shaped requirement, ask what is created, replaced,
updated, or deleted:

| Requirement | Resource interpretation |
| --- | --- |
| Start asynchronous work | Create a job in a job collection |
| Retry failed work | Create another attempt or job that references the failed one |
| Approve a request | Create or replace the request's approval resource |
| Revoke an active grant | Delete the grant or create a revocation resource when revocation has its own lifecycle |
| Replace a complete configuration | Replace a singleton policy or settings resource |
| Rotate a credential | Create a new credential in the credential collection |

An action verb in a summary or `operationId` is acceptable. An action verb used
as a URI procedure is evidence that a resource may still be missing.

## Method Semantics

| Method | Use | Required property |
| --- | --- | --- |
| `GET` | Read a representation | Safe and idempotent |
| `POST` | Create a collection member | Return the created resource or accepted work |
| `PUT` | Create or completely replace a known resource | Idempotent |
| `PATCH` | Partially update a resource | Declare the patch media type and semantics |
| `DELETE` | Remove a resource | Repeated requests have the same intended effect |

Return `201 Created` with `Location` when a resource exists immediately. Return
`202 Accepted` when work was accepted but the target resource or outcome does
not yet exist; identify the monitor resource. Return `204 No Content` only when
there is intentionally no representation.

Use conditional requests with `ETag`, `If-Match`, and `412 Precondition Failed`
when concurrent replacement or update could lose data. Define an idempotency
key for retryable non-idempotent requests at network boundaries. State its
scope, retention window, and conflict behavior.

## Collections

Define one pagination model across collections. Specify:

- stable ordering and tie-breaking;
- page size bounds;
- cursor or offset fields;
- continuation metadata or links;
- filter and sort syntax;
- behavior when the underlying collection changes.

Use collection replacement only when the client owns the complete set. `PUT`
replaces that set; `POST` creates one member; member `PATCH` updates one member.

## Representations And Links

Use explicit media types and schemas. Separate create, update, and response
schemas when server-managed or secret fields differ. Return secret material
only at its creation boundary when later reads must not expose it.

Expose canonical and related resource URIs through `Location`, `Link`, or
representation links when clients need them. Clients should not have to invent
URIs from undocumented string templates.

## Errors

Use one documented error media type and stable machine-readable codes. Prefer
`application/problem+json` when the surrounding API has no established
envelope. Distinguish:

- `400` malformed or invalid request;
- `401` missing or invalid authentication;
- `403` authenticated principal lacks authority;
- `404` resource not found or intentionally concealed;
- `409` request conflicts with current resource state;
- `412` failed conditional request;
- `422` syntactically valid representation violates domain constraints;
- `429` rate limit, with retry metadata when available.

Document every error response in OpenAPI. Do not turn a failure into a
successful representation containing an error flag.

## Review Gate

Reject the design until:

- every capability maps to a resource transition;
- every resource has one canonical URI;
- methods retain their standard safety and idempotency semantics;
- collection, concurrency, retry, and error behavior are explicit;
- authorization changes access, not resource identity;
- no dedicated CLI command is needed for routine resource operations.
