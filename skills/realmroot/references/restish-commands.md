# Registered API Resource Commands

Use this reference after Step 1 in `SKILL.md`. Realmroot publishes its generated
operations from `AUTH_ORIGIN/api/openapi.json`.

## Contents

- [Discover the resource](#discover-the-resource)
- [Request access](#request-access)
- [Issue target credentials](#issue-target-credentials)
- [Invoke the target](#invoke-the-target)
- [Diagnostics](#diagnostics)

## Discover The Resource

Translate the user's goal into the required capability and operation before
searching. Storage, wallets, payments, and paid APIs are capability patterns,
not fixed resource names.

Inspect pagination, then list every page of Agent-visible resources and
existing grants:

```bash
restish "$API_NAME" list-agent-api-resources --help
restish "$API_NAME" list-agent-api-resources -o json
restish "$API_NAME" list-agent-access-grants --help
restish "$API_NAME" list-agent-access-grants -o json
```

Search the discovered identifiers, names, scope values, and scope descriptions
for the required capability. Consider only resources whose status is
`available`. Select the exact `apiResourceId`, `authorizationMode`,
`resourceUrl`, requested scope values, and—only for `external`—
`accountConnectionId` from the response.
An external resource without a linked account requires the controller to
connect one at `$AUTH_ORIGIN/connections`. A native resource has no account
connection.

When several resources or accounts satisfy the request and the user's task does
not determine one, present their discovered identifiers and labels for
selection. Use the same selection path when the published metadata is
insufficient to establish a single match. Reuse an active grant only when its
resource, account, and scope set exactly match the selected request; otherwise
create a new least-privilege request.

Discovery is complete when either every value needed by one matching access
request is present in a response, or every resource page has been checked and
no registered resource provides the capability. In the latter case, report the
missing capability without creating an access request. Tenant-management
capabilities are outside this branch.

## Request Access

When no exact active grant exists, request access. For an `external` resource,
include the discovered account:

```bash
restish "$API_NAME" create-agent-access-request --rsh-validate -o json <<'JSON'
{
  "target": {
    "type": "api-resource",
    "apiResourceId": "resource_123",
    "accountConnectionId": "connection_123"
  },
  "scopes": ["projects:read"],
  "reason": "List projects for the controller"
}
JSON
```

For a `native` resource, use a request without an account:

```bash
restish "$API_NAME" create-agent-access-request --rsh-validate -o json <<'JSON'
{
  "target": {
    "type": "api-resource",
    "apiResourceId": "resource_123"
  },
  "scopes": ["projects:read"],
  "reason": "List projects for the controller"
}
JSON
```

Replace every example value with an exact discovered value and request only the
scopes needed by the user's task. The adapter opens the controller approval
page and keeps the request waiting.

If interrupted after request creation, resume inspection with the returned
request ID:

```bash
restish "$API_NAME" get-agent-access-request request_123 -o json
```

Access approval is complete only when the response contains an active
`grantId`. Denial or expiry closes that request; a retry starts with a fresh
access request.

## Issue Target Credentials

Issue credentials for the exact approved grant:

```bash
restish "$API_NAME" issue-target-access-token grant_123 -o json
```

Use only the safe metadata returned by Restish.

Credential issuance is complete when the response confirms the grant and exact
`resourceUrl`. It is an intermediate result, not completion of the user's API
task.

## Invoke The Target

Connect the discovered `resourceUrl`, inspect its generated operations, and run
the operation matching the user's request:

```bash
TARGET_API=corp-projects
RESOURCE_URL=https://api.example.com
restish api connect "$TARGET_API" "$RESOURCE_URL" --yes
restish api inspect "$TARGET_API"
restish "$TARGET_API" --help
restish "$TARGET_API" list-projects -o json
```

Use a user-supplied or unused local `TARGET_API` name. Reuse an existing name
only when inspection shows the exact `resourceUrl`; retarget it with
`--replace` only when the user explicitly selects that change.

The target publishes its OpenAPI contract through a `service-desc` link. The
adapter authenticates requests matching the registered `resourceUrl` and
refreshes reusable grants when needed.

For collection requests, inspect the generated pagination arguments and fetch
every page unless the user requested a bounded result.

## Diagnostics

Use generated operation names from:

```bash
restish "$API_NAME" --help
```

Diagnose discovery and authentication with redacted output:

```bash
restish doctor api "$API_NAME"
restish api auth inspect "$API_NAME" --redact
```

Surface target OAuth or DPoP errors and stop at that boundary.
