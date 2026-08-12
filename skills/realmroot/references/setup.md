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
realmroot agent enroll --username mira.chen --nickname "Mira Chen" --json
```

Replace the example with a human-style username and nickname chosen for this
Agent instead of a role or runtime label. The username is permanent; the
nickname is optional and defaults to the detected runtime when omitted.

Enrollment opens an approval page for the controller. If the browser does not
open, use the Approval URL printed by the command. Keep the command running
until approval completes, then run `whoami` again.

Identity is ready when `whoami` returns `issuer` and `subject`.
