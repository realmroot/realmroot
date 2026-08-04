# Realmroot Restish Plugin

`restish-realmroot` authenticates Realmroot and Resource Server requests for a
stable Agent identity. It contributes one plugin-local command group, `auth`,
for local profile and identity lifecycle operations. Remote business resources
and schemas still come from the OpenAPI contract.

## Agent Identity Lifecycle

Restish 2.3 mounts the plugin command declaration at its root, so the exact
surface is:

```text
restish auth status [--profile NAME]
restish auth list
restish auth login [NAME] [--api realmroot] [--api-profile default] [--agent-name NAME]
restish auth use NAME
restish auth logout [--profile NAME]
restish auth revoke INSTALLATION_ID [--profile NAME]
restish auth recover [--profile NAME] [--yes]
restish auth retire [--profile NAME] [--confirm SUBJECT]
```

`login` selects a configured Restish API/profile, enrolls or resumes its stable
Agent identity, and records a named lifecycle profile. `use` switches the
identity used by the authentication hook without environment-variable editing;
its response includes the matching `--rsh-profile NAME` selector because the
Restish 2.3 command-plugin protocol cannot rewrite an already resolved request
URL. The hook fails instead of authenticating a request sent to a deployment
that does not match the selected lifecycle profile. `status` reports the selected issuer,
stable subject/name, local runtime and session context, and current installation
without returning keys or tokens. `list` distinguishes local lifecycle profiles
from the remote installations registered to the selected identity.

The destructive operations are deliberately distinct:

- `logout` deletes only the selected local keys, credentials, and lifecycle
  profile. The remote Agent and its installations are unchanged.
- `revoke` replaces one remote installation's revocation. When it revokes the
  installation executing the command, that installation's local state is also
  removed; the stable identity is not recovered or retired.
- `recover` confirms the loss event locally, rotates the local protocol keys,
  and opens a dedicated hosted recovery approval. That page names the stable
  Agent and explains that approval revokes every obsolete binding and freezes
  Resource access. Only the controller's explicit recovery approval performs
  those remote changes and enrolls a replacement installation while preserving
  the stable issuer and subject. Its idempotency marker makes an interrupted
  recovery resumable.
- `retire` permanently retires the stable identity and then removes its local
  state. It requires the exact stable subject, either interactively or through
  `--confirm SUBJECT`; a mismatch cancels without mutation.

## Responsibilities

The plugin performs only work that must happen on the Agent's machine:

- generate and protect Agent, Host, and DPoP private keys;
- maintain named local lifecycle profiles and the currently selected profile;
- enroll or reuse the stable Agent identity discovered from
  `/.well-known/agent-configuration`;
- exchange the Agent assertion at the OAuth token endpoint and add a
  short-lived DPoP access token to Realmroot requests;
- recognize generic response profiles declared with `Link: ...; rel="profile"`;
- open a `user-approval` interaction and poll its supplied `links.self`;
- accept a generic DPoP credential offer, obtain and cache a short-lived
  credential, and return a token-free receipt;
- add `Authorization: DPoP ...` and a fresh proof to matching target requests.

Target profiles identify this hook with `provider: realmroot-target`. They may
also supply the discovered Realmroot `issuer`; the plugin uses it to select the
right local identity when local, staging, or production authorize the same
Resource Server URL. `auth use` governs this selection for subsequent target
requests and rejects a target configured for another issuer.

The plugin does not recognize Realmroot endpoint paths. It does not list or
select account connections, grants, authorization details, token endpoints,
native/external modes, or provider protocols. Realmroot resolves those on the
server and supplies links and credential-offer metadata.

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
    "self": "https://id.realmroot.dev/api/access/requests/request-1"
  }
}
```

The plugin validates same-origin control links, opens the supplied URL, and
polls `links.self` using the current OAuth credential until the interaction is
completed, denied, failed, or expired. Connection and access requests use this
contract; adding another interactive resource requires no plugin path change.

For a non-interactive process, set `REALMROOT_PLUGIN_APPROVAL_FILE` to a
protected path. The plugin writes the approval URL with mode `0600` instead of
launching a browser while the original command continues waiting.

## Generic Credential Offer

An approved access request may include:

```json
{
  "credentialOffer": {
    "type": "dpop",
    "resource": {"href": "https://id.realmroot.dev/api/resource-servers/zpan/resources/workspace-1"},
    "resourceIndicator": "https://drive.zpan.space/api",
    "endpoint": "https://id.realmroot.dev/api/access/authorizations/grant-1/credentials",
    "proof": {
      "algorithm": "ES256",
      "method": "POST",
      "uri": "https://drive.zpan.space/api/auth/token"
    }
  }
}
```

The plugin creates a separate P-256 key, signs the requested proof locally,
posts to the supplied same-origin credential endpoint, validates that the
short-lived response is bound to the exact Resource href and indicator, and
caches it. The visible result contains only status, Resource, scopes, and
expiry. Target traffic then goes directly to the Resource Server.

Expired credentials are renewed through the stored offer. If renewal is no
longer authorized, or the Resource Server returns `401`, the local credential
is removed and a new access request is required.

## State

Identity state is keyed by the discovered issuer and Agent runtime. Restish API
aliases and profiles reuse that identity. A lifecycle profile points to one
Restish API/profile, issuer, and runtime; it never copies identity state. The
same issuer/runtime cannot be aliased by two lifecycle names, and one lifecycle
name cannot silently switch to a different identity. Active Resource selection is isolated
by a hashed Agent session identifier when the runtime exposes one, allowing
concurrent sessions to use different Resources at the same service URL.

State files contain private keys and short-lived credentials. They are regular
files with mode `0600`; symlinks and files accessible to group or other users
are rejected. Legacy grant-oriented credential caches are discarded during
schema upgrade. Never commit, log, or copy state files.

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
