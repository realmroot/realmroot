# Resource Server Operations

Use this reference after completing identity setup. Realmroot exposes only the
resources an Agent needs to choose and act:

- a **Resource Server** is a registered service;
- a **Resource** is a provider-owned object or context offered by that service;
- a **connection** is whether the controller has linked the required account;
- **scopes** are the authority the Agent has or may request.

Do not inspect or select account connections, authorization-detail payloads,
grants, token endpoints, or tokens. Realmroot resolves those details.

## 1. Discover Resource Servers

List all pages:

```bash
restish get "$AUTH_ORIGIN/api/resource-servers?limit=100&offset=0" -o json
```

Follow `pagination.nextOffset` while `pagination.hasMore` is true. Match the
user's task against each server's `identifier`, `name`, `description`, and
declared `scopes`. Use only a server whose `availability.status` is
`available`.

The selected representation supplies all navigation values:

- `id` identifies the Resource Server in Realmroot commands;
- `serviceUrl` is the target API to call directly;
- `connection.status` is `connected`, `not_connected`, or `not_required`;
- `connection.authorizedScopes` is the authority already held by the linked
  account;
- `links.resources` is the provider-owned Resource collection;
- `links.connectionRequests` is present when account connection is supported.

Read any returned `links.self` or collection link with Restish's generic GET
when a generated command is unnecessary:

```bash
restish get "$RESOURCE_SERVER_SELF" -o json
restish get "$RESOURCES_URL?limit=100&offset=0" -o json
```

## 2. Establish Or Expand The Connection

Skip this step when `connection.status` is `connected` or `not_required`.
Otherwise request only the scopes needed to discover or use the target:

```bash
restish "$API_NAME" connect "$RESOURCE_SERVER_ID" --rsh-validate -o json <<'JSON'
{
  "scopes": ["objects:read"],
  "reason": "List files for the controller"
}
JSON
```

The plugin recognizes Realmroot's generic interactive-resource profile, opens
the controller URL, and waits on the response's `links.self`. The command
finishes only after the connection is established, denied, or expired. The
Agent does not open a separate polling command and does not handle the OAuth
callback.

To expand an existing connection for a Resource whose
`accountAuthorization.status` is `authorization_required`, repeat the same
command with that Resource href:

```bash
restish "$API_NAME" connect "$RESOURCE_SERVER_ID" --rsh-validate -o json <<JSON
{
  "resources": [{"href": "$RESOURCE_HREF"}],
  "scopes": ["objects:read"],
  "reason": "Authorize this workspace for the controller"
}
JSON
```

After completion, read the Resource Server and its Resources again. Do not
assume approval changed the requested state.

## 3. Discover Provider-Owned Resources

List all pages for the selected Resource Server:

```bash
restish get "$RESOURCES_URL?limit=100&offset=0" -o json
```

Each Resource supplies:

- `links.self`: the canonical href used in an access request;
- `name`, `description`, and `metadata`: selection information;
- `accountAuthorization.status`: whether the controller's account covers it;
- `agentAuthorization.authorizedScopes`: scopes already approved for this
  Agent;
- `agentAuthorization.requestableScopes`: additional scopes the Agent may ask
  the controller to approve.

Select an exact Resource from these responses. Never reconstruct its href from
an ID or display label. If no Resource matches, report that result instead of
inventing one. A native service normally exposes one `service` Resource.

## 4. Inspect And Connect The Target API

Use the selected Resource Server's `serviceUrl`. Reuse one semantic Restish API
name for the logical target service; use profiles for local, staging, account,
or tenant contexts.

```bash
TARGET_API=zpan
restish api connect "$TARGET_API" "$SERVICE_URL" --yes
restish "$TARGET_API" --help
```

The target's OpenAPI security requirements define the exact operation and
scope. Do not infer scopes from prose when the operation contract is
available.

Restish 2.3 does not configure `openIdConnect` security schemes. If it reports
the target requirement as unsupported, bind that declared scheme to the generic
Realmroot target provider. Derive the scheme ID and issuer from the target's
OpenAPI document; do not guess them or add Resource-Server-specific logic:

```bash
PROFILE=default
SECURITY_SCHEME=realmrootOidc
REALMROOT_ISSUER=https://id.realmroot.dev/api/auth
restish api set "$TARGET_API" \
  "profiles.${PROFILE}.credentials.${SECURITY_SCHEME}.auth.type: api-key" \
  "profiles.${PROFILE}.credentials.${SECURITY_SCHEME}.auth.params.in: header" \
  "profiles.${PROFILE}.credentials.${SECURITY_SCHEME}.auth.params.name: Authorization" \
  "profiles.${PROFILE}.credentials.${SECURITY_SCHEME}.auth.params.provider: realmroot-target" \
  "profiles.${PROFILE}.credentials.${SECURITY_SCHEME}.auth.params.value: DPoP" \
  "profiles.${PROFILE}.credentials.${SECURITY_SCHEME}.auth.params.issuer: ${REALMROOT_ISSUER}"
```

This temporary binding is tracked by Realmroot issue #138. The issuer selects
the correct local identity when multiple Realmroot environments authorize the
same target URL.

## 5. Request Exact Resource Access

Before invoking the target, request one short-lived credential for the selected
Resource and the complete current task. Include the union of scopes required by
the task's known operations, but no unrelated scopes. For example, a file
management task that will create, inspect, rename, and delete an object requests
`objects:create`, `objects:read`, `objects:update`, and `objects:delete` once.
This is task-level least privilege, not one access request per HTTP operation.

```bash
restish "$API_NAME" access --rsh-validate -o json <<JSON
{
  "resource": {"href": "$RESOURCE_HREF"},
  "scopes": ["objects:create", "objects:read", "objects:update", "objects:delete"],
  "reason": "Create, inspect, rename, and delete a file for the controller"
}
JSON
```

Realmroot decides whether existing controller authority can be reused. If a
decision is needed, the generic interaction handler opens the hosted approval
page and waits. When access is approved, Realmroot returns a generic credential
offer; the plugin creates a local DPoP key, obtains a short-lived credential,
stores it with the Resource href, and returns a safe receipt:

```json
{
  "status": "ready",
  "resource": {"href": "https://id.realmroot.dev/api/resource-servers/zpan/resources/workspace-1"},
  "resourceIndicator": "https://drive.zpan.space/api",
  "scopes": ["objects:read"],
  "tokenExpiresAt": "2026-08-03T16:30:00Z"
}
```

The Agent never chooses a grant and never sees a token. If the command is
interrupted, repeat the same access request; Realmroot resumes pending work or
reuses matching approved authority. Reuse the resulting cached credential for
every operation in that task. Request access again only when switching to a
different Resource, the credential expires or is rejected, or the task expands
to require a scope the cached credential does not contain. Existing persistent
controller authority may avoid another approval, but every issued credential
remains short-lived and bound to one Resource.

## 6. Invoke The Target

Run the target operation selected from its OpenAPI contract:

```bash
restish "$TARGET_API" objects list-objects -o json
```

The plugin matches the request URL to the active Resource credential and adds
`Authorization: DPoP ...` plus a fresh DPoP proof. Business traffic goes
directly to the Resource Server, not through Realmroot.

When an operation's OpenAPI response declares a header that must be forwarded
to a later request, capture that header explicitly. Restish changes its default
display when stdout is piped, so a header visible in an interactive terminal is
not guaranteed to be present in command substitution:

```bash
RESPONSE_HEADERS=$(restish "$TARGET_API" operation-name --rsh-print h -o json)
```

Read the declared header from `RESPONSE_HEADERS` and forward it unchanged. Do
not reconstruct a protocol header from the JSON response body. Use
`--rsh-print b` separately when the response body is also needed; replay only
when the operation contract guarantees idempotency.

On `401`, the plugin removes the rejected cached credential. Rediscover the
Resource, repeat the access request, and retry only after it succeeds. On
`403`, surface the target's authority error; do not broaden scopes without the
user's task requiring them.

Completion means the intended target operation succeeded. Resource discovery,
connection, approval, or a ready receipt alone is not completion.
