# Resource Lifecycle Reference

This matrix records current delete, revoke, and business-key behavior. The
decision and rationale live only in
[ADR 0012](../adr/0012-preserve-history-with-explicit-lifecycle-semantics.md).
Generated resource IDs are never reused.

| Resource or relationship | Current lifecycle behavior | Business-key behavior |
| --- | --- | --- |
| Resource Server | Soft delete with authorization cleanup | `identifier` and `resource_url` are reusable after deletion through active-row indexes |
| Agent identity | Soft delete with credential and grant revocation | `(issuer, subject)` and `username` remain permanently reserved |
| Application | Hard delete of its OAuth client and cascading records; disable is reversible | Slug and OAuth client identity are released |
| Organization | Hard delete with cascades; the platform Organization cannot be deleted; disable is reversible | Slug is released |
| Connector | Hard delete, rejected while a Resource Server references it; disable is reversible | Slug and provider identifier are released |
| Webhook endpoint | Hard delete with delivery-history cascade; disable is reversible | A recreated endpoint is independent |
| User | Hard delete after session cleanup; suspension is reversible | Username and email are released |
| Federated credential | Hard delete; disable is reversible | Application/issuer/subject tuple is released |
| Organization Role | Guarded hard delete with optimistic concurrency and audit | Organization/role key is released when no assignment blocks deletion |
| Organization member | Hard delete of the relationship | Organization/User tuple is reusable |
| Organization invitation | Cancellation records terminal status and `revoked_at` | Email is not unique; token hash remains permanent history |
| User, Application, and Agent Permission | Ended in place | Active-only uniqueness releases subject/resource/scope tuple after `ended_at` |
| Application authorization and consent | Revoked in place | Active-only uniqueness releases principal/resource tuple after `revoked_at` |
| Provider connection | Revoked, then reactivated or updated as the same relationship | Connector/owner tuple continues to identify that relationship |
| Provider Resource authorization and credential | Revoked, then reactivated or updated | Connection/Resource and credential slot continue to identify that relationship |
| Resource account connection | Revokes the durable Provider Resource authorization | Reconnection updates the same connection/Resource relationship |
| Agent host binding | Revoked in place | A protocol installation remains permanently bound to one Agent identity |
| Linked sign-in account and wallet address | Hard unlink after sign-in-method safety checks | Provider/account and wallet tuples are released |
| Session and passkey | Hard delete | Relationship keys are released; credential material is not reused |
| TOTP MFA | Removes the current factor | The same User may enroll a new factor |
| Agent activation and User suspension | DELETE removes a state subresource | Parent identity is unchanged and the state can be applied again |

Codes, token hashes, secret versions, idempotency keys, refresh-token lineage,
webhook attempt sequences, enrollment intents, access requests, and audit
identifiers remain unique while their rows are retained. They are replay or
historical identities, not reusable business names.

Resource Server deletion is atomic. The first successful request returns `204`;
a later retry resolves no active resource and returns `404`. Concurrent attempts
converge on the deleted state without converting a committed deletion into an
internal error.

Implementation sources: [authorization schema](../../server/db/schema/authorization-tables.ts),
[Agent identity schema](../../server/db/schema/agent-identity-tables.ts),
[external Resource schema](../../server/db/schema/external-resource-tables.ts),
[provider connection schema](../../server/db/schema/provider-connection-tables.ts),
and the [Resource API contract](../api/resource-api.md).
