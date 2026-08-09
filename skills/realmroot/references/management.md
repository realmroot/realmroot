# Realmroot Tenant Management

Use this reference only when the user explicitly requests Realmroot tenant
administration.

Realmroot is a built-in Resource Server in its own Resource Server inventory.
Its Resources are authority boundaries: Organization and User. The built-in
Realmroot Platform Organization owns platform-wide administration.
AgentAuth enrollment establishes identity only. Management requests use a
short-lived OAuth 2.0 access token bound to the selected Resource with DPoP.

## Obtain Management Access

Follow the normal Resource Server flow in
[restish-commands.md](restish-commands.md):

1. discover the Resource Server whose `identifier` is `realmroot`;
2. list its `links.resources` collection;
3. select exactly one Organization or User Resource whose
   `requestableScopes` cover the intended operations;
4. inspect the intended operations in the live OpenAPI document;
5. request the union of their declared OAuth scopes with the `access` command.

After approval, bind the returned credential source to Realmroot's `oauth2`
OpenAPI credential ID:

```bash
restish api auth add "$API_NAME" oauth2 \
  --source realmroot \
  --reference "$RESOURCE_HREF"
restish api auth inspect "$API_NAME" --operation getAgentStatus --redact
restish "$API_NAME" agents whoami --rsh-print b -o json
```

`getAgentStatus` must remain assigned to the `agentAuth` runtime resolver.
Never configure `agentAuth` or the legacy `dpop` ID in a Realmroot profile.

Select the Realmroot Platform Organization Resource for platform-wide
operations. Other Organization and User Resources remain restricted to their
own tenant. Request the union of scopes needed for one management task in one
approval; every issued token remains short-lived and bound to the selected
authority Resource.

Connectors and external Resource Servers are platform resources. Register or
change them only with the Realmroot Platform Organization Resource. Native
Resource Servers may be owned by another Organization when the live operation
and caller authority allow it.

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
| Agent inventory | `/agents` | `agents` |
| Agent access requests | `/access/requests` | `access-requests` |
| Connectors | `/connectors` | `connectors` |
| Realm settings | `/realm` | `settings` |
| Realm security policy | `/realm/security-policy` | `security` |
| Webhooks and deliveries | `/webhooks` | `webhooks` |
| Audit events | `/realm/audit-events` | `audit-events` |

The live OpenAPI operation is authoritative for its exact scope, request
schema, ETag requirements, and response headers.

## Operate Resources

Use Restish's generic resource operations; Restish selects the configured
`oauth2` credential and the adapter redeems or renews its Resource-bound offer:

```bash
restish get "$API_NAME/applications?limit=100&offset=0" --rsh-print b -o json
restish get "$API_NAME/applications/app_123" --rsh-print b -o json
restish post "$API_NAME/applications" --rsh-print b -o json < application.json
restish patch "$API_NAME/applications/app_123" --rsh-print b -o json < changes.json
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
