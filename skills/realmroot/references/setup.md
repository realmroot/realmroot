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

Normalize it into `AUTH_ORIGIN`. Use the stable local API name `realmroot`
unless the user explicitly supplied another service-level alias:

```bash
AUTH_ORIGIN="${AUTH_ORIGIN:-${REALMROOT_ORIGIN:-https://id.realmroot.dev}}"
AUTH_ORIGIN="${AUTH_ORIGIN%/}"
API_NAME="${API_NAME:-realmroot}"
```

`API_NAME` identifies the Realmroot service, not the selected deployment. Never
derive it from `AUTH_ORIGIN`, a hostname, an environment, a profile, an account,
a tenant, or a credential context. Do not create names such as
`realmroot-local`, `realmroot-staging`, or `realmroot-production`; represent
those contexts with profiles under the same API name.

Accept only an absolute origin containing a scheme, host, and optional port.
Use HTTPS except for an explicitly selected local or trusted test environment.
The configured origin has no `/api` suffix, path, query, fragment, or user
information.

Deployment resolution is complete when `AUTH_ORIGIN` contains the exact
deployment selected for subsequent commands and `API_NAME` remains the stable
service alias.

## Prepare Restish

Require Restish 2.3 or newer, Go 1.25.3 or newer, and the `realmroot` adapter
0.8.0 or newer:

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

Optionally name a new Agent before its first protected operation:

```bash
export REALMROOT_AGENT_NAME="Build Agent"
```

Preparation is complete when all three required versions are confirmed.

## Isolate Concurrent Agent Runtimes

The adapter keeps the Realmroot identity stable per Agent runtime and isolates
the current target credential by Agent session when the runtime exposes a
session identifier. Normally use its default state directory. For an explicit
cleanroom run or a runtime without session identity, allocate one directory
before the first command and export it for the entire shell session:

```bash
AGENT_STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/realmroot-agent.XXXXXX")"
chmod 700 "$AGENT_STATE_DIR"
export REALMROOT_PLUGIN_STATE_DIR="$AGENT_STATE_DIR"
```

Do not prefix only the Realmroot approval or token command with this variable.
Every later Realmroot command and every target Restish command must inherit the
same exported value; otherwise the target can use the wrong isolated
credential. Keep the directory for the duration of the workflow.

Isolation is complete when `REALMROOT_PLUGIN_STATE_DIR` is exported once and
the identity, access, token, and target-operation commands all run in that same
shell environment.

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
writes the hosted approval URL to this file with mode `0600` as soon as the
pending response arrives instead of launching a system browser. The supervising
controller reads that one URL, performs only the human approval, and leaves the
original command waiting until its terminal result. Remove the file before each
new approval-bearing command so stale URLs cannot be mistaken for the current
request.

Do not interrupt and retry merely because redirected command output is quiet.
Restish buffers plugin stderr until the hook completes; the handoff file is the
live boundary for non-interactive runtimes.

## Connect The API

The `default` profile always means production. If the stable API name is not
connected yet, connect the hosted production contract first, even when the
current task selected a non-production deployment. Realmroot's OpenAPI contract
owns the generated command layout; do not override it locally:

```bash
PRODUCTION_AUTH_ORIGIN=https://id.realmroot.dev
restish api connect "$API_NAME" "$PRODUCTION_AUTH_ORIGIN/api" --yes
```

For an existing connection, inspect it before changing anything. The default
base URL must remain the production API. Refresh that contract without
retargeting it:

```bash
restish api inspect "$API_NAME"
restish api sync "$API_NAME"
```

If the selected origin differs from production, keep the API name and default
profile unchanged and add or select the explicit `local` or `staging` profile.
Never use `--replace` or another API name merely to switch environments. Do not
leave a local or staging origin in the default profile.

Connection is complete when inspection shows the resolved origin as either the
default base URL or the selected profile base URL.

## Add A Profile

Use a named profile whenever the resolved deployment or credential context
differs from production. Deployment profile names are `local` and `staging`;
do not use `production`, because production is the default:

```bash
PROFILE_NAME=staging
PROFILE_ORIGIN=https://auth.example.com
PROFILE_ORIGIN="${PROFILE_ORIGIN%/}"
restish api set "$API_NAME" \
  "profiles.${PROFILE_NAME}.base_url: ${PROFILE_ORIGIN}/api"
restish api inspect "$API_NAME"
restish -p "$PROFILE_NAME" "$API_NAME" auth whoami -o json
AUTH_ORIGIN="$PROFILE_ORIGIN"
export RSH_PROFILE="$PROFILE_NAME"
```

Validate `PROFILE_ORIGIN` by the same origin rules. Keep each profile's
credentials isolated and invoke its first protected operation explicitly.
Profiles resolving to the same issuer may reuse the stable identity; a
different issuer uses a separate identity.

Profile setup is complete when inspection shows the exact profile base URL and
its explicit `whoami` call succeeds. Keep the selected
`RSH_PROFILE` and matching `AUTH_ORIGIN` for every later branch command. Adding
more Realmroot deployments or credential contexts always adds profiles, never
API names.

## Establish Identity

Invoke the generated identity operation in the selected profile:

```bash
restish "$API_NAME" auth whoami -o json
```

On first use, the adapter registers a stable Agent, opens the controller's
approval page, waits, and resumes the same operation after approval. The
controller signs in and decides; the Agent remains the Restish request
identity.

Repeat `whoami` after interruption to resume enrollment. Use
`AUTH_ORIGIN/api/auth` as the returned OIDC issuer and consume its discovery
metadata for OIDC endpoints.
