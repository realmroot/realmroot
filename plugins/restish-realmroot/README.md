# Realmroot Restish Plugin

`restish-realmroot` authenticates Realmroot and Resource Server requests for a
stable Agent identity. It contributes no commands and contains no
Resource-Server-specific business logic. Commands and schemas come from the
OpenAPI contract.

## Responsibilities

The plugin performs only work that must happen on the Agent's machine:

- generate and protect Agent, Host, and DPoP private keys;
- enroll or reuse the stable Agent identity discovered from
  `/.well-known/agent-configuration`;
- add a fresh Agent possession proof to Realmroot requests;
- recognize generic response profiles declared with `Link: ...; rel="profile"`;
- open a `user-approval` interaction and poll its supplied `links.self`;
- accept a generic DPoP credential offer, obtain and cache a short-lived
  credential, and return a token-free receipt;
- add `Authorization: DPoP ...` and a fresh proof to matching target requests.

Target profiles identify this hook with `provider: realmroot-target`. They may
also supply the discovered Realmroot `issuer`; the plugin uses it to select the
right local identity when local, staging, or production authorize the same
Resource Server URL.

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
    "self": "https://id.realmroot.dev/api/access-requests/request-1"
  }
}
```

The plugin validates same-origin control links, opens the supplied URL, and
polls `links.self` using the current Agent proof until the interaction is
completed, denied, failed, or expired. Capability, connection, and access
requests all use this contract; adding another interactive resource requires
no plugin path change.

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
    "endpoint": "https://id.realmroot.dev/api/access-requests/request-1/credentials",
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
aliases and profiles reuse that identity. Active Resource selection is isolated
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
