# Realmroot And Restish Contract

Read this reference only when the API will be registered with Realmroot or used
through Restish.

## Realmroot Resource Discovery

The exact registered resource URL must return a successful unauthenticated
response that advertises the OpenAPI document with an RFC 8631 `service-desc`
link:

```http
Link: </openapi.json>; rel="service-desc"; type="application/openapi+json"
```

The linked JSON or YAML document must be OpenAPI 3.x. Production resource URLs
use HTTPS and contain no user information. Loopback development URLs may use
HTTP.

Declare an OAuth 2.0 or OpenID Connect security scheme. Put every required
business scope in the standard `security` requirement of the operation that
uses it, or in inherited document security. Descriptive text, provider
metadata, and custom extensions do not make a scope requestable.

Treat the target OpenAPI document as the authority for business scopes.
Realmroot may fetch it again while access is requested, approved, or issued.

The durable integration reference is:

```text
https://github.com/saltbo/realmroot/blob/main/docs/integrations/resource-servers.md
```

## Generic Restish Surface

Give every operation a stable unique `operationId`, even when no generated
command is visible. Mark routine resource operations:

```yaml
x-cli-hidden: true
```

They remain described by OpenAPI and are invoked with generic API-relative
commands:

```bash
restish get inventory/widgets
restish post inventory/widgets < widget.json
restish patch inventory/widgets/widget-123 'name: Updated'
restish delete inventory/widgets/widget-123
restish edit inventory/widgets/widget-123
```

Restish can match generic requests to cached OpenAPI operations and apply their
security requirements. Verify the match and credential coverage with:

```bash
restish doctor api inventory
restish api auth inspect inventory --operation getWidget --redact
```

Use `x-cli-ignore: true` only when an operation must not exist in the generated
CLI at all. Use `x-mcp-ignore: true` independently when an operation must not be
exposed as an MCP tool.

The current Restish extension reference is:

```text
https://rest.sh/docs/reference/openapi-cli-integration/
```

## Exceptional Commands

Default to no dedicated commands. An exception must coordinate behavior outside
one HTTP exchange, for example:

- generate and retain a local key;
- open a browser for human interaction;
- create a request and wait or poll for its resolution;
- select and bind a local credential;
- store a secret in protected local storage;
- resume the original operation after the workflow completes.

When the integration actually provides that orchestration, use a short
user-facing first tag as the command group and `x-cli-name` as the command
name. Keep the resource-oriented `operationId` as the stable machine identity.

```yaml
tags: [auth]
x-cli-name: authorize
```

Do not expose a command merely to replace `get`, `post`, `put`, `patch`,
`delete`, or `edit` with another verb.

Return the whitelist as:

| Group | Name | Operation ID | Orchestration reason |
| --- | --- | --- | --- |

An empty table is valid and preferred when the API has no qualifying workflow.
