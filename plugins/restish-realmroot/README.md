# Realmroot Restish Plugin

`restish-realmroot` authenticates Realmroot and Resource Server requests for a
stable Agent identity. It contributes no commands and contains no
Resource-Server-specific business logic. Commands and schemas come from the
OpenAPI contract.

## Responsibilities

The plugin performs only work that must happen on the Agent's machine:

- generate and protect Agent, Host, and DPoP private keys;
- explicitly enroll or reuse the stable Agent identity discovered from
  `/.well-known/agent-configuration`;
- cache validated discovery metadata per origin for five minutes;
- exchange the Agent assertion at the OAuth token endpoint and add a
  short-lived DPoP access token containing exactly the selected operation's
  declared scopes;
- recognize generic response profiles declared with `Link: ...; rel="profile"`;
- open a `user-approval` interaction and poll its supplied `links.self`;
- accept a generic DPoP credential offer, store it under a locally generated
  opaque credential-source reference, and return a token-free receipt;
- add `Authorization: DPoP ...` and a fresh proof to matching target requests.

Restish passes the final request URL and one complete OpenAPI security
alternative to the plugin. Realmroot Resource operations use the standard
`oauth2` credential ID. Valid same-origin Agent discovery lets the plugin
resolve only OAuth requirements covered by the published Agent bootstrap
scopes. The `agentAssertion` credential ID is accepted only for the discovered
Agent enrollment endpoint; it performs AgentAuth registration and controller
approval before signing that enrollment request.

Restish selects an explicitly configured `oauth2` credential or
`--rsh-auth` override before asking this plugin to resolve missing operation
authentication. When that credential is a Realmroot credential-source
reference, the source delegates Realmroot's published Agent bootstrap scopes
to the same local Agent identity. Other scopes must still match an approved
Resource credential offer. The plugin never guesses between an Agent and an
Application after an explicit credential has been selected.

Successful new-identity enrollment responses declare the generic
`agent-enrollment` profile. Before the command returns, the plugin exchanges an
`agent:read` token, reads the stable issuer and subject, and durably stores that
identity. The enrollment request carries a locally stable idempotency key, so a
retry after a lost response returns the same server enrollment. `whoami` only
reads this completed local identity and never finishes enrollment implicitly.

Restish API names and aliases do not affect those decisions. The plugin does
not list or select account connections, Permissions, authorization details,
token endpoints, native/external modes, or provider protocols. Realmroot
resolves those on the server and supplies links and credential-offer metadata.

## Generic Interaction Protocol

Any successful response is interactive when its `Link` header declares:

```http
Link: <https://realmroot.dev/profiles/interactive-resource>; rel="profile"
Retry-After: 2
```

The representation contains an Agent identity, an interaction, and a
canonical polling link:

```json
{
  "id": "request-1",
  "agentId": "agent-identity-1",
  "status": "pending",
  "interaction": {
    "type": "user-approval",
    "status": "pending",
    "url": "https://id.realmroot.dev/agent/approve#token=opaque",
    "expiresAt": "2026-08-03T16:30:00Z"
  },
  "links": {
    "self": "https://id.realmroot.dev/api/agent/access-requests/request-1"
  }
}
```

The plugin validates same-origin control links, opens the supplied URL, and
polls `links.self` using the short-lived Agent protocol OAuth credential until
the interaction is completed, denied, failed, or expired. That credential is
limited to identity, discovery, request, polling, and credential-issuance
operations; it does not authorize Realmroot management or target Resource
operations. Connection and access requests use this contract; adding another
interactive resource requires no plugin path change.

For a non-interactive process, set `REALMROOT_PLUGIN_APPROVAL_FILE` to a
protected path. The plugin writes the approval URL with mode `0600` instead of
launching a browser while the original command continues waiting.

## Generic Credential Offer

An approved access request may include:

```json
{
  "credentialOffer": {
    "type": "dpop",
    "resourceIndicator": "https://drive.zpan.space/api",
    "authorizationDetails": [
      {"type": "https://zpan.space/authorization-details/workspace", "identifier": "workspace-1"}
    ],
    "endpoint": "https://id.realmroot.dev/api/agent/access-requests/request-1/credentials",
    "proof": {
      "algorithm": "ES256",
      "method": "POST",
      "uri": "https://drive.zpan.space/api/auth/token"
    }
  }
}
```

The plugin stores the offer under a locally generated `rrcs_...` reference.
That reference remains stable for the same Resource Server authorization context. Later approvals
replace only an offer with the same scopes and retain offers for every other
approved scope set; different authorization details receive a different reference. After
the reference is added to a Restish API credential, Restish creates a separate
P-256 key and asks the plugin to redeem the least broad stored offer covering
the operation scopes. The plugin posts to the supplied same-origin credential
endpoint and validates that the short-lived response is bound to the exact
resource indicator and authorization details. The visible access result contains only status,
resource indicator, authorization details, scopes, and the opaque credential-source reference. Target traffic
then goes directly to the Resource Server.

Restish deliberately bypasses response middleware when it streams an HTTP body
as raw bytes. Scripts that create, resume, or inspect an interactive Resource
must select a decoded format such as `--rsh-output-format json` so the plugin can
capture the credential offer before Restish prints the response.

Expired credentials are renewed through the stored offer. If renewal is no
longer authorized, the rejected offer is removed while its opaque credential
source binding remains available for a later approval. If the Resource Server
returns `401`, Restish removes the rejected access token. A new access request
is required in either case.

Credential-source lookup never creates an access request or opens an approval
interaction. When no stored offer covers the target operation's scopes, the
plugin returns an actionable error. The Agent must explicitly request exact
Resource access, complete any controller approval, and retry the target
operation.

## State

Host state is keyed by the discovered issuer, so runtimes on the same device
share one Host registration and Host key. Agent state is additionally keyed by
runtime, so each runtime keeps its own Agent key and stable identity. Restish
API aliases and profiles reuse that runtime identity. Active Resource selection
is isolated by a hashed Agent session identifier when the runtime exposes one,
allowing concurrent sessions to use different Resources at the same service
URL.

State files contain private keys, short-lived protocol credentials, and
approved credential offers. They are regular files with mode `0600`; symlinks
and files accessible to group or other users are rejected. State created before
the opaque credential-source layout must be removed and enrolled again. Never
commit, log, or copy state files.

Set `AGENT` to override runtime detection. Set
`REALMROOT_PLUGIN_STATE_DIR` only when an explicitly isolated cleanroom is
required, and export it for both Realmroot and target commands.

## Development

```bash
pnpm run plugin:test
pnpm run plugin:build
restish plugin install ./plugins/restish-realmroot/restish-realmroot --yes
restish plugin list
```

Inspect the manifest:

```bash
restish plugin debug restish-realmroot -- --rsh-plugin-manifest
```
