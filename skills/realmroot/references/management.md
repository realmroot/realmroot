# Realmroot Tenant Management

Use this reference only when the user explicitly requests Realmroot tenant
administration.

Realmroot is a built-in Resource Server in its own Resource Server inventory.
Its Resources are tenant boundaries: one Organization or one User. Realm
administration remains a human platform permission rather than a tenant.
AgentAuth enrollment establishes identity only. Management
requests use a short-lived OAuth 2.0 access token bound to the selected Resource
with DPoP.

## Obtain Management Access

Follow the normal Resource Server flow in
[restish-commands.md](restish-commands.md):

1. discover the Resource Server whose `identifier` is `realmroot`;
2. list its `links.resources` collection;
3. select exactly one Organization or User Resource;
4. inspect the intended operations in the live OpenAPI document;
5. request the union of their declared OAuth scopes with the `access` command.

The controller may approve several scopes together, but every issued token is
short-lived and restricted to exactly one authority Resource. Reuse that token
for the task. Request another Resource when changing authority boundaries.

Do not request AgentAuth capabilities, use an Agent assertion as a Resource API
credential, or provision an API key. The adapter keeps the Agent assertion for
the OAuth token endpoint and manages DPoP access tokens locally.

## Current Resource Groups

| Resource group | Collection path | OAuth scope prefix |
| --- | --- | --- |
| Applications and OIDC clients | `/applications` | `applications` |
| Application consents | `/access/consents` | `applications` |
| Resource Servers | `/resource-servers` | `resource-servers` |
| Organizations | `/organizations` | `organizations` |
| Users and security state | `/users` | `users` |
| Agents and Resource access | `/agents`, `/agents/{agentId}/access-grants`, `/access/requests` | `agents` |
| Connectors | `/connectors` | `connectors` |
| Realm settings | `/realm` | `settings` |
| Realm security policy | `/realm/security-policy` | `security` |
| Webhooks and deliveries | `/webhooks` | `webhooks` |
| Audit events | `/realm/audit-events` | `audit-events` |

The live OpenAPI operation is authoritative for its exact scope, request
schema, ETag requirements, and response headers.

Organization Role definitions and member Role replacement are human
membership operations under `/organizations/{organizationId}/roles` and
`/organizations/{organizationId}/members/{memberId}/roles`. Agents and
workloads cannot receive or mutate Roles; they use direct scopes.

## Operate Resources

Use Restish's generic resource operations; the adapter automatically selects
the cached Realmroot credential for the active authority Resource:

```bash
restish get "$API_NAME/applications?limit=100&offset=0" -o json
restish get "$API_NAME/applications/app_123" -o json
restish post "$API_NAME/applications" -o json < application.json
restish patch "$API_NAME/applications/app_123" -o json < changes.json
```

Read before mutation, use canonical IDs and links from responses, apply the
smallest requested change, and read the resource again afterward. Use
`If-Match` whenever the operation contract declares it.

## Management Boundaries

- State the resolved deployment before mutation and obtain confirmation when a
  production mutation was not explicit in the task.
- Never reuse a token for another Realmroot authority Resource.
- Send asset uploads as `multipart/form-data` with one `file` field.
- Route one-time secrets directly to a user-approved protected destination.
- Confirm the exact target before destructive operations.
