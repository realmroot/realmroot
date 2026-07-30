# Realmroot Tenant Management

Use this reference after Step 1 in `SKILL.md`.

## Contents

- [Request authority](#request-authority)
- [Operate resources](#operate-resources)
- [Management boundaries](#management-boundaries)

## Request Authority

Realmroot management requests keep the Agent's stable `(issuer, subject)`
principal. Request `{resource}:read` for reads and `{resource}:write` for
mutations, limited to the resources in the user's task.

For application administration:

```bash
restish "$API_NAME" capability request --rsh-validate -o json <<'JSON'
{
  "capabilities": ["applications:read", "applications:write"],
  "reason": "Administer Realmroot applications"
}
JSON
```

The adapter opens the controller approval page and waits. Approval is complete
when the response contains active grants for every requested capability. A
denied or expired request must be replaced with a fresh request.

After approval, rerun the intended management operation. Capability approval
does not replay mutations.

## Operate Resources

Use generic HTTP commands for routine resource operations:

```bash
restish doctor api "$API_NAME"
restish get "$API_NAME/applications" -o json
restish get "$API_NAME/applications/app_123" -o json
```

Read the current resource before mutation, select the exact ID from that
response, and apply the smallest requested change:

```bash
restish post "$API_NAME/applications" -o json < application.json
```

After mutation, read the exact resource again for verification. Approval and
credential workflows remain visible under the API command:

```bash
restish "$API_NAME" --help
restish doctor api "$API_NAME"
restish api auth inspect "$API_NAME" --redact
```

Confirm the exact target before a destructive operation.

## Management Boundaries

- State the resolved `AUTH_ORIGIN` before mutation. When it defaulted to the
  production origin `https://id.realmroot.dev` instead of being supplied for
  the task, obtain confirmation before mutating.
- Keep management capabilities separate from product OAuth scopes and target
  API scopes.
- Send asset uploads as `multipart/form-data` with one `file` field.
- Treat raw secrets as create/rotation-only output; list and detail operations
  return metadata.
