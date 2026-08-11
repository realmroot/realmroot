# Manage Realmroot

Use Realmroot administration only when the user explicitly asks for it.

`platform` is the reserved Resource Server name for Realmroot itself:

```bash
realmroot toolbox platform
realmroot toolbox platform --search "<management capability>"
realmroot toolbox platform <group> <operation> --help
```

Select the authorization detail shown for the intended organization or user.
Use the Realmroot Platform Organization only for platform-wide administration.

Request the scopes shown by the selected operation:

```bash
realmroot agent request \
  --resource-server platform \
  --scope <scope> \
  --authorization-detail '<exact-json-from-toolbox>' \
  --reason "Perform the requested Realmroot administration"
```

Then run the generated `realmroot toolbox platform` operation. Read before a
change, modify only what the user requested, and read the Resource again to
verify it. Confirm the target before destructive operations.
