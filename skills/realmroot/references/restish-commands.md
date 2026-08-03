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
An external resource may have no linked account yet. Connect it through the
separate hosted connection workflow before requesting Agent access. A native
resource has no account connection.

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

# Bind the target's Realmroot-backed security scheme in the new profile.
# Use the credential ID declared by the target OpenAPI document and the exact
# space-separated scopes selected for this workflow.
TARGET_CREDENTIAL_ID=oauth2
TARGET_SCOPES="projects:read"
restish api set "$TARGET_API" \
  "profiles.${TARGET_PROFILE}.credentials.${TARGET_CREDENTIAL_ID}.auth.type: api-key" \
  "profiles.${TARGET_PROFILE}.credentials.${TARGET_CREDENTIAL_ID}.auth.params.in: header" \
  "profiles.${TARGET_PROFILE}.credentials.${TARGET_CREDENTIAL_ID}.auth.params.name: Authorization" \
  "profiles.${TARGET_PROFILE}.credentials.${TARGET_CREDENTIAL_ID}.auth.params.provider: realmroot-target" \
  "profiles.${TARGET_PROFILE}.credentials.${TARGET_CREDENTIAL_ID}.auth.params.value: DPoP" \
  "profiles.${TARGET_PROFILE}.credentials.${TARGET_CREDENTIAL_ID}.auth.params.scopes: ${TARGET_SCOPES}"
restish api inspect "$TARGET_API"
restish -p "$TARGET_PROFILE" api auth inspect "$TARGET_API"
restish -p "$TARGET_PROFILE" "$TARGET_API" --help
```

Do not stop after adding only `base_url`: a profile without the security-scheme
binding cannot use the target token even when Realmroot issued it successfully.
The profile is ready when auth inspection reports the selected credential as
configured and the intended operation as callable.

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

Keep the target service's default Restish profile on its canonical production
resource URL. Put non-production resource URLs under the explicit `local` or
`staging` profile and use that profile for every target command. Never make a
local discovery result the target API's default merely because the current
task is local.

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
  "authorizationDetails": [
    {
      "type": "https://api.example.com/authorization-details/project",
      "identifier": "project_123"
    }
  ],
  "scopes": ["projects:read"],
  "reason": "List projects for the controller"
}
JSON
```

Use the exact `authorizationDetail` object returned by `access contexts` as
the single entry in the top-level `authorizationDetails` array. Do not place
it inside `target`, rename the field to singular, or reconstruct it from its
display label. Omit `authorizationDetails` only when the selected resource
does not advertise authorization contexts.

For a `native` resource, use a request without an account:

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

For an external resource without a connected account, request the connection
first. This step accepts scopes but never accepts authorization details and
never creates an Agent grant:

```bash
restish "$API_NAME" access connect resource_123 --rsh-validate -o json <<'JSON'
{
  "scopes": ["projects:read"],
  "reason": "Connect the controller's project account"
}
JSON
```

The adapter validates and opens the returned hosted approval URL, keeps the
command waiting, and replaces the pending response with `status: connected`
after the controller finishes. The controller signs in, connects or updates
the provider account, and selects one or more workspaces at the provider. A
failed or expired connection exits with an error. Query authorization contexts
only after the command returns connected.

For a resource that advertises authorization contexts, inspect the account's
live catalog before requesting access:

```bash
restish "$API_NAME" access contexts resource_123 -o json
```

Each item reports whether the connected provider account already authorizes
that exact context. If the selected item has `connectionAuthorized: false`,
invoke `access connect` again with the required scopes before requesting Agent
access. This is an account-authorization update, not a new account. The command
must remain in the foreground until the controller finishes the provider
consent; then read the catalog again and require the selected item to report
`connectionAuthorized: true`.

Follow `pagination.nextOffset` until `hasMore` is false. Each item reports the
exact `authorizationDetail`, whether the connected account has authorized it,
and matching active Agent grants. When the response has
`connectionRequired: true`, run `access connect` and do not create an access
request yet. Use one exact detail in each access request and never send a
generic type-only template;
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

Successful issuance exits with status zero and prints nothing. The adapter
stores the credential in protected state and suppresses the full HTTP response
because it contains the bearer token. Any token response printed to stdout is a
security failure; do not parse or display it. The explicit structured formatter
is mandatory because Restish's default redirected-output fast path bypasses
response middleware.

Credential issuance is complete when the command exits successfully. Confirm
the selected workspace by invoking the intended target operation and checking
its resource data. Issuance is an intermediate result, not completion of the
user's API task.

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
