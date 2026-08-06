# Realmroot Setup And Identity

Use this reference before every Realmroot branch. It is the single source for
deployment selection, Restish setup, profiles, and stable Agent identity.

## Contents

- [Resolve the deployment](#resolve-the-deployment)
- [Prepare Restish](#prepare-restish)
- [Isolate concurrent Agent runtimes](#isolate-concurrent-agent-runtimes)
- [Connect the API](#connect-the-api)
- [Add a profile](#add-a-profile)
- [Establish identity](#establish-identity)

## Resolve The Deployment

Use an origin explicitly supplied for the task, then an existing `AUTH_ORIGIN`,
then `REALMROOT_ORIGIN`; otherwise use the hosted production origin
`https://id.realmroot.dev`.

Normalize it into `AUTH_ORIGIN`. Use `realmroot` as the stable API name:

```bash
AUTH_ORIGIN="${AUTH_ORIGIN:-${REALMROOT_ORIGIN:-https://id.realmroot.dev}}"
AUTH_ORIGIN="${AUTH_ORIGIN%/}"
API_NAME="${API_NAME:-realmroot}"
```

`API_NAME` identifies the service. Profiles under that name identify
deployments, accounts, tenants, and credential contexts.

Accept only an absolute origin containing a scheme, host, and optional port.
Use HTTPS except for an explicitly selected local or trusted test environment.
The configured origin has no `/api` suffix, path, query, fragment, or user
information.

Deployment resolution is complete when `AUTH_ORIGIN` is the exact selected
origin and `API_NAME` is the stable service alias.

## Prepare Restish

Require Restish 2.3 or newer, Go 1.25.3 or newer, and the `realmroot` adapter
0.9.0 or newer:

```bash
restish --version
go version
restish plugin list
```

Install or upgrade a missing or outdated adapter:

```bash
PLUGIN_BIN_DIR="$(go env GOPATH)/bin"
GOBIN="$PLUGIN_BIN_DIR" go install github.com/saltbo/realmroot/plugins/restish-realmroot@latest
restish plugin install "$PLUGIN_BIN_DIR/restish-realmroot" --yes
restish plugin list
```

Optionally name a new Agent before explicit login:

```bash
export REALMROOT_AGENT_NAME="Build Agent"
```

Preparation is complete when all three required versions are confirmed.

## Isolate Concurrent Agent Runtimes

The adapter keeps the Realmroot identity stable per Agent runtime and isolates
the current target credential by Agent session when the runtime exposes a
session identifier. Normally use its default state directory. For an explicit
cleanroom run, isolate both the Restish registry and the adapter state before
the first command. This prevents temporary API connections, profiles, tokens,
and plugin state from polluting the operator's normal Restish configuration:

```bash
RESTISH_CONFIG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/realmroot-restish.XXXXXX")"
AGENT_STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/realmroot-agent.XXXXXX")"
chmod 700 "$RESTISH_CONFIG_DIR"
chmod 700 "$AGENT_STATE_DIR"
export RSH_CONFIG_DIR="$RESTISH_CONFIG_DIR"
export REALMROOT_PLUGIN_STATE_DIR="$AGENT_STATE_DIR"
```

Export both variables once for the whole cleanroom workflow. Every Realmroot
and target Restish command must inherit them. Keep both directories for the
duration of the workflow. Do not use an isolated Restish registry for an
ordinary persistent setup: its stable service connections belong in the
normal config.

Isolation is complete when `RSH_CONFIG_DIR` and
`REALMROOT_PLUGIN_STATE_DIR` are exported once and the connect, identity,
access, token, and target-operation commands all run in that same shell
environment.

## Hand Off Controller Approval In Non-Interactive Runtimes

The adapter prints approval URLs directly to an interactive terminal. When the
Agent process has no terminal, or a separate controller process must open the
page, configure a protected handoff file before starting an approval-bearing
foreground command:

```bash
APPROVAL_HANDOFF="$REALMROOT_PLUGIN_STATE_DIR/controller-approval.url"
rm -f "$APPROVAL_HANDOFF"
export REALMROOT_PLUGIN_APPROVAL_FILE="$APPROVAL_HANDOFF"
```

Start the Realmroot command in the foreground and keep it running. The adapter
writes the hosted approval URL to this file with mode `0600`. The controller
reads that URL and performs the approval while the original command waits for
its terminal result. Remove the file before each new approval-bearing command.

## Connect The API

The `default` profile is production. First inspect the registry. There must be
at most one entry for the logical Realmroot service, named `realmroot`; never
create an environment-specific API alias:

```bash
restish api list
restish api inspect "$API_NAME"
```

Only when the stable entry is absent, connect the hosted production contract:

```bash
PRODUCTION_AUTH_ORIGIN=https://id.realmroot.dev
restish api connect "$API_NAME" "$PRODUCTION_AUTH_ORIGIN/api" --yes
```

For an existing connection, inspect it and refresh the published contract:

```bash
restish api inspect "$API_NAME"
restish api sync "$API_NAME"
```

Represent an explicitly requested non-production deployment with a `local` or
`staging` profile under the same API name. External users need only the
`default` production profile unless they intentionally use another deployment.

Connection is complete when inspection shows the resolved origin as either the
default base URL or the selected profile base URL.

## Add A Profile

Use a named profile whenever the resolved deployment or credential context
differs from production. Deployment profile names are `local` and `staging`:

```bash
PROFILE_NAME=staging
PROFILE_ORIGIN=https://auth.example.com
PROFILE_ORIGIN="${PROFILE_ORIGIN%/}"
restish api set "$API_NAME" \
  "profiles.${PROFILE_NAME}.base_url: ${PROFILE_ORIGIN}/api"
restish api inspect "$API_NAME"
restish auth login --hostname "${PROFILE_ORIGIN#*://}"
restish -p "$PROFILE_NAME" "$API_NAME" whoami -o json
AUTH_ORIGIN="$PROFILE_ORIGIN"
export RSH_PROFILE="$PROFILE_NAME"
```

Validate `PROFILE_ORIGIN` by the same origin rules. Keep each profile's
credentials isolated and invoke login explicitly.
Profiles resolving to the same issuer may reuse the stable identity; a
different issuer uses a separate identity.

Profile setup is complete when inspection shows the exact profile base URL and
its explicit login and `whoami` calls succeed. Keep the selected `RSH_PROFILE` and
matching `AUTH_ORIGIN` for every later branch command.

## Establish Identity

Log in first, then invoke the generated current-identity operation:

```bash
restish auth login
restish "$API_NAME" whoami -o json
```

Login registers or restores the runtime's stable Agent, opens the controller's
approval page, waits, and resumes the same operation after approval. The
controller signs in and decides; the Agent remains the Restish request
identity.

Repeat `restish auth login` after interruption to resume enrollment. `whoami`
is read-only and returns a clear not-logged-in error instead of enrolling. Use
`AUTH_ORIGIN/api/auth` as the returned OIDC issuer and consume its discovery
metadata for OIDC endpoints.
