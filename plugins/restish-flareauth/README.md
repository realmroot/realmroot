# FlareAuth Restish Plugin

`restish-flareauth` is the Restish v2 authentication adapter for FlareAuth's
unified OpenAPI contract. It contributes no commands. `whoami` and every
resource operation are generated from `/api/openapi.json`.

Registration and later Agent requests require Ed25519 possession proofs. The
plugin owns those proof keys locally and adds a fresh AgentAuth proof before
Restish sends each protected operation.

The first protected operation is a foreground device-style flow. The plugin
prints one controller approval URL to the terminal, waits while the controller
reviews it, creates the stable identity, signs the original request, and lets
that same operation continue.

## Development

From the repository root:

```bash
pnpm run plugin:test
pnpm run plugin:build
restish plugin install ./plugins/restish-flareauth/restish-flareauth --yes
restish plugin list
```

Inspect the manifest:

```bash
restish plugin debug restish-flareauth -- --rsh-plugin-manifest
```

`plugin debug` resolves binaries from `PATH`; add Restish's plugin directory to
`PATH` or pass a development binary already available there.

## State

State is keyed by Restish API and profile.
The default root is:

```text
<user-config>/restish/plugins/flareauth/agents
```

Set `FLAREAUTH_PLUGIN_STATE_DIR` to use an explicit protected directory. State
files contain Agent and Host private keys, are created with mode `0600`, and
must not be committed or copied into logs. The plugin rejects state files that
are symlinks or accessible to group/other users.

The current filesystem backend is intentionally isolated behind `stateStore`.
A platform keychain or hardware-backed signer can replace it without changing
the Restish command surface.

## Architecture

- The plugin implements only Restish's `auth` hook.
- The OpenAPI credential marker activates it only for FlareAuth operations.
- The hook has a ten-minute deadline so the original operation can wait for
  controller approval.
- The plugin never authenticates a CLI request as the approving user.
- Business and governance commands remain owned by the OpenAPI contract.
