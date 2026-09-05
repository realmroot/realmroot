# Direct Agent permissions

A User controller can provision permissions before an Agent requests access:

- GET `/api/agents/{agentId}/permission-contexts?resource=<resource-url>` lists
  paginated native or external Contexts available to that Agent's controller.
- POST `/api/agents/{agentId}/permissions` accepts `resourceServerId`, `scope`,
  `authorizationDetails`, `mode` (persistent or until), optional `expiresAt`,
  and optional `accountConnectionId`.

The operations require permissions:read/write respectively and the target
Agent's controller. User-delegated OAuth applications are supported. An Agent
principal cannot use these endpoints to grant itself or another Agent authority.

Creation shares request-approval validation: enabled resource and identity,
visibility, current native Context, controller effective scopes, external
connection ownership, and contextual upstream scopes. Permissions use the
existing resource_scope_entitlement table with a null sourceAccessRequestId.
Equivalent active grants reuse their identity and can extend their lifetime.
No synthetic access request or new table is introduced.

The existing Agent access request flow recognizes these grants immediately.
The CLI acquires granted Context authority in fresh Sessions without opening
controller approval. New authority still requires explicit authorization.

Review acceptance: use a controller of an active Agent, select a Context from
the GET response, grant a published scope, repeat the POST and verify the same
permission id. A first Agent request for that Context and scope is approved
without interaction. A different controller and out-of-bound scopes are denied.
