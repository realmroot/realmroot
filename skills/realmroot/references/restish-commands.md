# Registered API Resource Requests

Use this reference after Step 1 in `SKILL.md`. Realmroot publishes its complete
operation metadata from `AUTH_ORIGIN/api/openapi.json`. Routine single-request
operations use Restish's generic HTTP commands; approval and credential
workflows retain generated commands.

## Contents

- [Discover the resource](#discover-the-resource)
- [Inspect the target](#inspect-the-target)
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
restish get "$API_NAME/agent/api-resources?limit=100&offset=0" -o json
restish get "$API_NAME/agent/access-grants?limit=100&offset=0" -o json
```

Search the discovered identifiers, names, catalog descriptions, scope values,
and scope descriptions for the required capability. Consider only resources
whose status is `available`. Shortlist the exact `apiResourceId`,
`connectorId` and `resourceUrl`; a null Connector means native authorization.
Do not request access yet.
An external resource may have no linked account yet; the controller can choose
or connect one during hosted approval. A native resource has no account
connection.

When several resources satisfy the request and the catalog does not establish a
single match, inspect each candidate's target contract before asking the user
to select. Present identifiers and labels only when the target contracts still
leave multiple valid choices.

Catalog discovery is complete when at least one candidate URL is available for
target inspection, or every resource page has been checked and no registered
resource provides the capability. In the latter case, report the missing
capability without creating an access request. Tenant-management capabilities
are outside this branch.

## Inspect The Target

Connect Restish directly to each shortlisted `resourceUrl` and inspect the
target's generated operations before choosing scopes or requesting access:

```bash
TARGET_API=projects
RESOURCE_URL=https://api.example.com
restish api connect "$TARGET_API" "$RESOURCE_URL" --yes
restish "$TARGET_API" --help
restish "$TARGET_API" list-projects --help
```

`TARGET_API` identifies the target's logical service, not the selected resource
URL or request context. Choose a user-supplied name or a stable semantic service
name from the target contract. Never include an environment, deployment,
hostname, account, tenant, profile, or credential context in it; names such as
`projects-local`, `projects-staging`, and `projects-production` are invalid.

Before connecting, run `restish api list` and inspect the semantic service
candidate with `restish api inspect`. If the logical service is already
connected, reuse its API name. When the selected `resourceUrl` differs from its
default base URL, add or select a profile instead of creating another API name
or retargeting the existing one:

```bash
TARGET_API=projects
TARGET_PROFILE=staging
RESOURCE_URL=https://staging-api.example.com
restish api set "$TARGET_API" \
  "profiles.${TARGET_PROFILE}.base_url: ${RESOURCE_URL}"
restish api inspect "$TARGET_API"
restish -p "$TARGET_PROFILE" "$TARGET_API" --help
```

Profiles also separate account, tenant, and credential contexts for the same
logical target service. Create another API name only for a genuinely different
logical service. Retarget an existing default with `--replace` only when the
user explicitly asks to replace that service's default context.

The target publishes its OpenAPI contract through a `service-desc` link. Treat
that contract—not Realmroot—as the authority for operation names, arguments,
and required scopes. Select the exact operation and its least-privilege scope
set. Then select an `accountConnectionId` only when an `external` resource
already has the required account.

When several accounts satisfy the operation and the user's task does not
determine one, present their redacted labels for selection. Reuse an active
grant only when its resource, account, and scope set exactly match the selected
operation; otherwise create a new least-privilege request.

## Request Access

When no exact active grant exists, request access. For an `external` resource
with the required account already connected, include it:

```bash
restish "$API_NAME" access request --rsh-validate -o json <<'JSON'
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

For a `native` resource, or an `external` resource whose account must be chosen
or connected during approval, use a request without an account:

```bash
restish "$API_NAME" access request --rsh-validate -o json <<'JSON'
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

For a resource that advertises authorization contexts, inspect the account's
live catalog before requesting access:

```bash
restish "$API_NAME" access contexts resource_123 -o json
```

Follow `pagination.nextOffset` until `hasMore` is false. Each item reports the
exact `authorizationDetail`, whether the connected account has authorized it,
and matching active Agent grants. Use one exact detail in each access request;
if an active grant already covers the required scopes, issue credentials from
that grant directly and do not create another approval request. If
`connectionAuthorized` is false, request account reauthorization instead of
claiming that the workspace does not exist.

If interrupted after request creation, resume inspection with the returned
request ID:

```bash
restish get "$API_NAME/agent/access-requests/request_123" -o json
```

Access approval is complete only when the response contains an active
`grantId`. Denial or expiry closes that request; a retry starts with a fresh
access request.

## Issue Target Credentials

Issue credentials for the exact approved grant:

```bash
restish "$API_NAME" access token grant_123 -o json
```

Use only the safe metadata returned by Restish.

Credential issuance is complete when the response confirms the grant and exact
`resourceUrl`. It is an intermediate result, not completion of the user's API
task.

## Invoke The Target

Run the target operation selected during inspection:

```bash
restish "$TARGET_API" list-projects -o json
restish -p "$TARGET_PROFILE" "$TARGET_API" list-projects -o json
```

Use the first form for the default context and the second for a named profile.
Keep the target profile selected with an explicit `-p "$TARGET_PROFILE"` or a
matching `RSH_PROFILE` whenever the operation does not use the default context.
The adapter authenticates requests matching the registered `resourceUrl` and
refreshes reusable grants when needed.

For collection requests, inspect the generated pagination arguments and fetch
every page unless the user requested a bounded result.

## Diagnostics

Inspect the focused workflow command surface:

```bash
restish "$API_NAME" --help
restish doctor api "$API_NAME"
```

Diagnose discovery and authentication with redacted output:

```bash
restish doctor api "$API_NAME"
restish api auth inspect "$API_NAME" --redact
```

Surface target OAuth or DPoP errors and stop at that boundary.
