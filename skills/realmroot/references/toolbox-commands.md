# Discover Permissions And Run Commands

Use known Resource Server names, Contexts, operations, and approved authority
without rediscovering them. Discover only information missing for the current
task or refresh after an authorization or credential failure.

When the Resource Server is unknown, list services. Otherwise inspect only the
selected server, optionally with a narrow search:

```bash
realmroot toolbox
realmroot toolbox <resource-server>
realmroot toolbox <resource-server> --search "<capability>"
realmroot toolbox <resource-server> --scope <scope>
```

Use only names, scopes, and Contexts published by discovery.

When the selected Resource Server advertises Agent Skills, install the
task-relevant Skills using the exact commands printed by Toolbox, then apply
their instructions using the mechanism available in the current Agent runtime.
If it advertises no relevant Skill, continue with operation discovery and help;
missing Agent Skills are not an execution error.

Inspect Contexts only when no default is selected, multiple Contexts could
match, or the task requires an override:

```bash
realmroot toolbox <resource-server> context
realmroot toolbox <resource-server> context show <context-id>
realmroot toolbox <resource-server> context use <context-id>
```

Use `--context <context-id>` for a one-time override; use `context use` only when the
user wants to change the default.

Inspect operation help only when its arguments or required scopes are unknown:

```bash
realmroot toolbox <resource-server> <group> <operation> --help
```

Use existing approved authority first. If discovery shows missing authority or
the operation returns `403`, request all missing task scopes together:

```bash
realmroot agent request \
  --resource-server <resource-server> \
  --scope <scope> \
  --context <context-id> \
  --reason "Perform the requested operation"
```

Repeat `--scope` when the task needs multiple scopes. Omit `--context` when the
service has no Context or the selected default is correct.

The command opens controller approval when needed and waits for the result.

```bash
realmroot toolbox <resource-server> <group> <operation> <arguments> --json
```

Use generic HTTP operations when appropriate:

```bash
realmroot toolbox get <resource-server>/<path> --json
realmroot toolbox post <resource-server>/<path> --content-type application/json --json < body.json
```

Address registered Resource Servers by their Toolbox name. Realmroot resolves
the deployment URL internally. Use an absolute URL only for an unregistered
public HTTP target.

Use a native tool only when the Resource Server advertises it:

```bash
realmroot exec github -- git <arguments>
realmroot exec github -- gh <arguments>
realmroot exec cloudflare -- wrangler <arguments>
```

Add `--context <context-id>` before `--` only for a one-time Context override.

Native commands do not request or expand authority. If `exec` reports missing
authority, inspect the selected server and request only the required scopes.
Preserve the native command's arguments and check its exit status and output.

### Git And GitHub Identity

Use plain `git` for local operations such as `status`, `diff`, and `add`. Use
Realmroot for Agent-attributed commits and authenticated GitHub operations:

```bash
realmroot exec github -- git commit <arguments>
realmroot exec github -- git push <arguments>
realmroot exec github -- gh <arguments>
```

The wrapper sets process-local `user.name` and `user.email` from the immutable
Agent username without changing Git configuration. A plain `git commit` uses
the repository or global Git identity.
