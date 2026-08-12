# Start Using Realmroot

## Confirm The CLI

```bash
realmroot --help
```

The command should list `agent`, `toolbox`, and `exec`. If `realmroot` is not
installed, report that prerequisite instead of inventing another access path.

Realmroot uses its hosted service by default. When the user explicitly selects
another Realmroot deployment, pass it with `--realmroot-origin` or set
`REALMROOT_ORIGIN` for the task.

## Confirm The Agent Identity

```bash
realmroot agent whoami --json
```

If the Agent is not enrolled, run:

```bash
realmroot agent enroll --username mira --nickname "Mira Chen" --json
```

Replace the example with a short lowercase human handle and nickname chosen for
this Agent instead of a role or runtime label. Start with a simple handle such
as `mira`; only choose another available handle if enrollment reports a name
conflict. The username is permanent. The nickname is optional and defaults to
the detected runtime when omitted.

Enrollment opens an approval page for the controller. If the browser does not
open, use the Approval URL printed by the command. Keep the command running
until approval completes, then run `whoami` again.

Identity is ready when `whoami` returns `issuer` and `subject`.

For task access, `realmroot agent request` opens the approval page and waits by
default. When the controller is away from this computer, use
`realmroot agent request --no-wait ... --json` and give the returned
`approvalUrl` to the controller; the command exits without opening a browser or
polling.
