# Realmroot Setup And Identity

Use this reference before every Realmroot branch. It is the single source for
deployment selection, Restish setup, profiles, and stable Agent identity.

## Contents

- [Resolve the deployment](#resolve-the-deployment)
- [Prepare Restish](#prepare-restish)
- [Connect the API](#connect-the-api)
- [Add a profile](#add-a-profile)
- [Establish identity](#establish-identity)

## Resolve The Deployment

Use an origin explicitly supplied for the task, then an existing `AUTH_ORIGIN`,
then `REALMROOT_ORIGIN`; otherwise use the hosted production origin
`https://id.realmroot.dev`.

Normalize it into `AUTH_ORIGIN` and use `realmroot` as the default local API
name:

```bash
AUTH_ORIGIN="${AUTH_ORIGIN:-${REALMROOT_ORIGIN:-https://id.realmroot.dev}}"
AUTH_ORIGIN="${AUTH_ORIGIN%/}"
API_NAME="${API_NAME:-realmroot}"
```

Accept only an absolute origin containing a scheme, host, and optional port.
Use HTTPS except for an explicitly selected local or trusted test environment.
The configured origin has no `/api` suffix, path, query, fragment, or user
information.

Deployment resolution is complete when `AUTH_ORIGIN` and `API_NAME` contain the
exact values that subsequent commands will use.

## Prepare Restish

Require Restish 2.3 or newer, Go 1.25.3 or newer, and the `realmroot` adapter
0.3.0 or newer:

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

## Connect The API

For a new API name or an intentional retarget, connect the unified OpenAPI
contract:

```bash
restish api connect "$API_NAME" "$AUTH_ORIGIN/api" --replace --yes
```

For an existing connection that still targets the resolved origin, refresh its
contract:

```bash
restish api sync "$API_NAME"
```

Inspect before proceeding when the target is uncertain:

```bash
restish api inspect "$API_NAME"
```

Connection is complete when the inspected base URL is exactly
`$AUTH_ORIGIN/api`.

## Add A Profile

Use this section only when the user needs another environment or credential
context under the same local API name:

```bash
PROFILE_NAME=staging
PROFILE_ORIGIN=https://auth.example.com
PROFILE_ORIGIN="${PROFILE_ORIGIN%/}"
restish api set "$API_NAME" \
  "profiles.${PROFILE_NAME}.base_url: ${PROFILE_ORIGIN}/api"
restish api inspect "$API_NAME"
restish -p "$PROFILE_NAME" "$API_NAME" get-current-agent -o json
AUTH_ORIGIN="$PROFILE_ORIGIN"
export RSH_PROFILE="$PROFILE_NAME"
```

Validate `PROFILE_ORIGIN` by the same origin rules. Keep each profile's
credentials isolated and invoke its first protected operation explicitly.
Profiles resolving to the same issuer may reuse the stable identity; a
different issuer uses a separate identity.

Profile setup is complete when inspection shows the exact profile base URL and
its explicit `get-current-agent` call succeeds. Keep the selected
`RSH_PROFILE` and matching `AUTH_ORIGIN` for every later branch command.

## Establish Identity

Invoke the generated identity operation in the selected profile:

```bash
restish "$API_NAME" get-current-agent -o json
```

On first use, the adapter registers a stable Agent, opens the controller's
approval page, waits, and resumes the same operation after approval. The
controller signs in and decides; the Agent remains the Restish request
identity.

Repeat `get-current-agent` after interruption to resume enrollment. Use
`AUTH_ORIGIN/api/auth` as the returned OIDC issuer and consume its discovery
metadata for OIDC endpoints.
