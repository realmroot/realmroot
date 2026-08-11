# Discover Permissions And Run Commands

## Discover Resource Servers

List the services available to the Agent:

```bash
realmroot toolbox
```

Inspect the service that matches the user's task:

```bash
realmroot toolbox <resource-server>
```

For a large service, search for the capability or exact scope instead of
printing everything:

```bash
realmroot toolbox <resource-server> --search "<capability>"
realmroot toolbox <resource-server> --scope <scope>
```

Use only Resource Server names, operations, scopes, and authorization details
shown by these commands.

## Inspect The Operation

Inspect the selected operation before calling it:

```bash
realmroot toolbox <resource-server> <group> <operation> --help
```

The help shows its arguments and required scopes. For operations with a body,
use `--generate-body` when an example is needed.

## Request Permission

Request all scopes needed for the current task together:

```bash
realmroot agent request \
  --resource-server <resource-server> \
  --scope <scope> \
  --authorization-detail '<exact-json-from-toolbox>' \
  --reason "Perform the requested operation"
```

Repeat `--scope` when the task needs multiple scopes. Include
`--authorization-detail` only when the service overview provides a specific
account, organization, repository, or other target to select. Copy that JSON
exactly.

The command opens controller approval when needed and waits for the result.
Do not run each business command once merely to discover missing permission;
use Toolbox discovery and operation help first.

## Run The Operation

Run the selected service operation:

```bash
realmroot toolbox <resource-server> <group> <operation> <arguments> --json
```

Use generic HTTP operations when appropriate:

```bash
realmroot toolbox get <target> --json
realmroot toolbox post <target> --content-type application/json --json < body.json
```

Use a native tool only when the Resource Server advertises it:

```bash
realmroot exec github -- git <arguments>
realmroot exec github -- gh <arguments>
realmroot exec cloudflare -- wrangler <arguments>
```

Call `realmroot agent request` before `exec`; native commands do not request
permissions themselves. Preserve the native command's normal arguments and
check its exit status and output.

On `403`, inspect the operation's scopes again and request a missing scope only
when the user's task requires it.
