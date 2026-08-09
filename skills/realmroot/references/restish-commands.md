# Resource Server Operations

Use this reference after completing identity setup. Realmroot exposes only the
resources an Agent needs to choose and act:

- a **Resource Server** is a registered service;
- a **Resource** is a provider-owned object or context offered by that service;
- a **connection** is whether the controller has linked the required account;
- **scopes** are the authority the Agent has or may request.

The Agent-facing model stops at Resource Servers, Resources, connections, and
scopes. Realmroot resolves grants, authorization details, token endpoints, and
credentials.

## 1. Discover Resource Servers

List all pages:

```bash
restish get "$API_NAME/resource-servers?limit=100&offset=0" --rsh-print b -o json
```

Follow `pagination.nextOffset` while `pagination.hasMore` is true. Match the
user's task against each server's `identifier`, `name`, `description`, and
declared `scopes`. Use only a server whose `availability.status` is
`available`.

The selected representation supplies all navigation values:

- `id` identifies the Resource Server in Realmroot commands;
- `resourceUrl` is the target API and OAuth resource indicator;
- `connection.status` is `connected`, `not_connected`, or `not_required`;
- `connection.authorizedScopes` is the authority already held by the linked
  account;
- `links.resources` is the provider-owned Resource collection;
- `links.connectionRequests` is present when account connection is supported.

Use the registered Realmroot API short name for Realmroot requests so Restish
applies the selected profile and plugin hooks. Keep returned absolute hrefs only
when a request schema requires a canonical href:

```bash
restish get "$API_NAME/resource-servers/$RESOURCE_SERVER_ID" --rsh-print b -o json
restish get "$API_NAME/resource-servers/$RESOURCE_SERVER_ID/resources?limit=100&offset=0" --rsh-print b -o json
```

## 2. Establish Or Expand The Connection

Skip this step when `connection.status` is `connected` or `not_required`.
Otherwise request only the scopes needed to discover or use the target:

```bash
restish "$API_NAME" resource-servers connect "$RESOURCE_SERVER_ID" --rsh-validate --rsh-print b -o json <<'JSON'
{
  "scopes": ["<required-scope>"],
  "reason": "Use the requested capability for the controller"
}
JSON
```

The plugin recognizes Realmroot's generic interactive-resource profile, opens
the controller URL, follows `links.self`, and waits until the connection is
established, denied, or expired.

To expand an existing connection for a Resource whose
`accountAuthorization.status` is `authorization_required`, repeat the same
command with that Resource href:

```bash
restish "$API_NAME" resource-servers connect "$RESOURCE_SERVER_ID" --rsh-validate --rsh-print b -o json <<JSON
{
  "resources": [{"href": "$RESOURCE_HREF"}],
  "scopes": ["$REQUIRED_SCOPE"],
  "reason": "Authorize the selected resource for the controller"
}
JSON
```

After completion, read the Resource Server and its Resources again and use the
returned state.

## 3. Discover Provider-Owned Resources

List all pages for the selected Resource Server:

```bash
restish get "$API_NAME/resource-servers/$RESOURCE_SERVER_ID/resources?limit=100&offset=0" --rsh-print b -o json
```

Each Resource supplies:

- `links.self`: the canonical href used in an access request;
- `name`, `description`, and `metadata`: selection information;
- `accountAuthorization.status`: whether the controller's account covers it;
- `agentAuthorization.authorizedScopes`: scopes already approved for this
  Agent;
- `agentAuthorization.requestableScopes`: additional scopes the Agent may ask
  the controller to approve.

Select the exact Resource and canonical href from these responses. If no
Resource matches, report that result. A native service normally exposes one
`service` Resource.

## 4. Inspect And Connect The Target API

Use the selected Resource Server's `resourceUrl`. Reuse one semantic Restish API
name for the logical target service; use profiles for local, staging, account,
or tenant contexts. An environment is never a separate API.

```bash
TARGET_API=target-service
restish api list
restish api inspect "$TARGET_API"
restish "$TARGET_API" --help
```

If the stable API entry is absent, connect its production service URL once:

```bash
restish api connect "$TARGET_API" "$PRODUCTION_SERVICE_URL" --yes
```

If the entry exists and this task explicitly targets another deployment, add
or update a profile on it instead of reconnecting under a new name:

```bash
TARGET_PROFILE=staging
restish api set "$TARGET_API" \
  "profiles.${TARGET_PROFILE}.base_url: ${SERVICE_URL}"
restish api inspect "$TARGET_API"
export RSH_PROFILE="$TARGET_PROFILE"
```

The `default` profile remains production. Do not pre-create non-production
profiles for external users; profiles are local configuration added only when
that environment is actually selected.

The target's OpenAPI security requirements define the exact operation, scope,
and credential ID. Do not invent a credential ID or auth scheme; use the one
shown by `restish api auth inspect "$TARGET_API"`.

## 5. Request Exact Resource Access

Before invoking the target, request one short-lived credential for the selected
Resource and the complete current task. Include the union of scopes required by
the task's known operations, but no unrelated scopes. This is task-level least
privilege, not one access request per HTTP operation. Derive every scope from
the selected Resource Server's published contract; do not assume scope names
from another service.

```bash
restish "$API_NAME" agent-access access --rsh-validate --rsh-print b -o json <<JSON
{
  "resource": {"href": "$RESOURCE_HREF"},
  "scopes": ["$REQUIRED_SCOPE"],
  "reason": "Perform the requested operation on the selected resource"
}
JSON
```

Realmroot decides whether existing controller authority can be reused. If a
decision is needed, the generic interaction handler opens the hosted approval
page and waits. When access is approved, Realmroot returns a generic credential
offer. The plugin stores only that offer and returns the opaque source
reference Restish needs:

```json
{
  "status": "ready",
  "resource": {"href": "https://id.realmroot.dev/api/resource-servers/service-id/resources/resource-id"},
  "resourceIndicator": "https://api.example.com",
  "scopes": ["<required-scope>"],
  "credentialSource": {
    "name": "realmroot",
    "reference": "https://id.realmroot.dev/api/resource-servers/service-id/resources/resource-id"
  }
}
```

Register that source against the credential ID published by the target's
OpenAPI contract:

```bash
restish api auth add "$TARGET_API" "$CREDENTIAL_ID" \
  --source realmroot \
  --reference "$RESOURCE_HREF"
restish api auth inspect "$TARGET_API" --redact
```

When the target is Realmroot itself, bind the Resource credential only to the
published `oauth2` credential ID. Never bind a Resource credential to
`agentAuth` or the legacy `dpop` ID: `agentAuth` belongs exclusively to the
plugin-managed Agent protocol credential. After binding Realmroot `oauth2`,
verify that `getAgentStatus` is still delegated to the auth resolver and that
`whoami` succeeds.

This is explicit local Restish configuration, not dynamic request injection.
Restish owns the target DPoP private key, short-lived token cache, request
proofs, renewal, and one forced renewal after a `401`. The plugin owns only the
Realmroot Agent protocol credential and redeems the stored offer when Restish
asks it to issue or renew a target credential. Neither component exposes a
grant to the Agent.

If the access command is interrupted, repeat the same request; Realmroot
resumes pending work or reuses matching approved authority. Reuse the Restish
credential binding for that Resource and scope set. Request access again when
switching Resources, when Realmroot rejects renewal, or when the task needs
additional scopes.

## 6. Invoke The Target

Run the generated operation selected from the target's current help and OpenAPI
contract:

```bash
restish "$TARGET_API" <generated-operation> --rsh-print b -o json
```

Restish selects the configured OpenAPI credential, obtains or reuses its
short-lived token, and adds `Authorization: DPoP ...` plus a fresh proof bound
to the exact request. Business traffic goes directly to the Resource Server,
not through Realmroot.

When an operation's OpenAPI response declares a header that must be forwarded
to a later request, capture that header explicitly. Restish changes its default
display when stdout is piped, so a header visible in an interactive terminal is
not guaranteed to be present in command substitution:

```bash
RESPONSE_HEADERS=$(restish "$TARGET_API" operation-name --rsh-print h -o json)
```

Read the declared header from `RESPONSE_HEADERS` and forward its exact value.
Use `--rsh-print b` separately when the response body is also needed. Replay an
operation only when its contract guarantees idempotency.

On `401`, Restish forces one credential renewal and retries once. If Realmroot
rejects renewal, rediscover the Resource and repeat the access request. On
`403`, surface the target's authority error. Request additional scopes only
when the user's task requires them.

If the credential source reports that no approved offer covers the operation
scopes, do not retry the target or expect the plugin to start approval. Return
to step 5, request exact Resource access explicitly, complete any controller
approval, and then retry the target operation.

Completion means the intended target operation succeeded. Resource discovery,
connection, approval, or a ready receipt alone is not completion.
