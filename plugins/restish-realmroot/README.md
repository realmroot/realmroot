# Realmroot Restish Plugin

`restish-realmroot` is the Restish v2 authentication adapter for Realmroot's
unified OpenAPI contract. It contributes no commands. The contract retains
generated commands only for identity, approval, and credential workflows;
routine resource operations use Restish's generic HTTP commands. Run
`restish doctor api realmroot` to enumerate their methods, paths, and operation
IDs.

Registration and later Agent requests require Ed25519 possession proofs. The
plugin discovers the issuer and Agent endpoints from
`/.well-known/agent-configuration`, owns the proof keys locally, and adds a
fresh AgentAuth proof before Restish sends each protected operation.

The first protected operation is a foreground device-style flow. The plugin
prints one controller approval URL to the terminal, waits while the controller
reviews it, creates the stable identity, signs the original request, and lets
that same operation continue.

The unified contract generates `auth whoami`, `capability request`, resource
connection, `access request`, and `access token` workflows. Resource and grant
reads use generic API-relative requests. When a resource connection or exact
resource access request is pending, the response hook opens the hosted
controller decision page and waits for the terminal result.

For the current access grant on each API Resource, the plugin creates a separate
P-256 DPoP key. It discovers the proof target from RFC 9728 and RFC 8414 for
external resources, uses the Realmroot token operation for native resources,
adds the standard `DPoP` header, and stores the resulting short-lived token with
the protected Agent state. A newly approved grant for the same resource replaces
the old local grant binding and DPoP key.

The plugin stores issued target tokens in protected state and suppresses the
entire token response. Token issuance must use an explicit structured formatter
so Restish invokes response middleware instead of its redirected raw-output
fast path. The API resource's `resourceUrl` can then be connected directly:

```bash
restish api connect projects https://api.example.com --yes
restish projects list-projects -o json
```

An API name identifies one logical service. Keep the same API name across its
environments, deployments, accounts, tenants, and credential contexts, and use
Restish profiles for those contexts. Do not create environment-qualified names
such as `projects-staging`; add `profiles.staging.base_url` to `projects`.
The default profile is the canonical production deployment. Use explicit
`local` and `staging` profiles for non-production deployments.

Restish follows the resource's RFC 8631 `service-desc` link to its OpenAPI
contract. The global auth hook recognizes the registered resource URL and adds
`Authorization: DPoP ...` plus a fresh request proof. The token belongs to the
target platform and target traffic never passes through Realmroot.

## Development

From the repository root:

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

`plugin debug` resolves binaries from `PATH`; add Restish's plugin directory to
`PATH` or pass a development binary already available there.

## State

State is keyed by the discovered Realmroot Agent issuer and the current Agent
runtime. Restish API names, profiles, and individual runtime sessions do not
change the identity. By default the plugin detects the runtime from the same
tool environment markers used by Agent Kanban. Set `AGENT` to an explicit
runtime name when a runtime needs to declare or override its identity key.

Each runtime gets a separate Agent identity by default. Reusing the same
`AGENT` value intentionally reuses that runtime identity across sessions.
Existing API/profile-keyed state is migrated when it can be matched
unambiguously to the discovered issuer.

The state schema is upgraded in place. Identity and Host keys are preserved,
while incompatible legacy or authorization-mode-less DPoP credential caches are
discarded. The next resource access then requires a current active grant rather
than reusing ambiguous credentials from an older authorization model.

Expired persistent or limited credentials are refreshed through their active
grant with the same DPoP key. An expired one-time credential, an inactive grant,
or a replacement grant removes the obsolete local resource credential and
requires the applicable current grant or a new controller decision.
A `401` from a matching target resource also removes its cached credential.
Discover the current resource and connection state, then invoke `access request`
with the exact task scopes and without `accountConnectionId`. The hosted
approval offers the controller a scoped account connection when none exists;
after OAuth, the controller separately approves the Agent grant. Issue its
target token before retrying. Restish's target API logout does not own or clear
Realmroot plugin state.

The default root is:

```text
<user-config>/restish/plugins/realmroot/agents
```

Set `REALMROOT_PLUGIN_STATE_DIR` to use an explicit protected directory. State
files contain Agent, Host, and grant-specific DPoP private keys plus short-lived
target tokens. They are created with mode `0600` and must not be committed or
copied into logs. The plugin rejects state files that are symlinks or accessible
to group/other users.

The current filesystem backend is intentionally isolated behind `stateStore`.
A platform keychain or hardware-backed signer can replace it without changing
the Restish command surface.

## Architecture

- The `auth` hook discovers endpoints, enrolls the Agent when needed, signs
  Realmroot requests, and authenticates matching target API requests.
- The `response-middleware` hook opens and waits for controller approval when
  a generated capability, API Resource connection, or API Resource access
  operation returns pending.
- The Realmroot OpenAPI credential marker activates AgentAuth; registered target
  resource URLs activate DPoP authentication through the global hook.
- Both hooks have a ten-minute deadline for their foreground approval flow.
- The plugin never authenticates a CLI request as the approving user.
- Business and governance commands remain owned by the OpenAPI contract.
