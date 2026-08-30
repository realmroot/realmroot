# Lifecycle key policy

Realmroot keeps audit and authorization history when lifecycle state ends. The
default policy for a soft-deleted resource is **active-record uniqueness**:
deletion releases its business keys for a newly created resource while the old
row remains available to historical references. A permanent reservation is an
exception that requires a stable-identity, security, or audit reason documented
below.

## Soft-deleted resources

| Resource | Lifecycle marker | Unique business keys | Policy |
| --- | --- | --- | --- |
| Resource Server (`api_resource`) | `deleted_at` | `identifier`, `resource_url` | Active-record uniqueness. Partial indexes apply only while `deleted_at is null`, so a new resource may reuse either key after deletion. Active collisions return `409 conflict`; history is never restored or reassigned. |
| Agent identity (`agent_identity`) | `deleted_at` | `(issuer, subject)`, `username` | Permanently reserved. Enrollment and profile claims return `409 conflict`; no API restores or reassigns either key. |

`agent_identity` is the only current exception to the soft-delete default. Its
issuer/subject pair is the Agent's stable security identity, its username is a
public immutable identity, and both are referenced by authentication,
authorization, and audit history. Reassignment would make a new Agent appear to
be the historical principal.

Agent identity indexes remain unconditional to preserve historical references.
Resource Server indexes are migrated from unconditional to active-record
partial indexes without changing or deleting historical rows. Database adapters
translate active collisions at their boundary and preserve the original error
as its cause.

## Deletion operation inventory

This inventory follows the public Management and Account API delete operations
through their use cases and repositories. “Reusable” means a new resource may
claim the same business key; generated resource IDs are never reused.

| Resource or relationship | Delete behavior | Business-key result |
| --- | --- | --- |
| Resource Server | Soft delete plus atomic authorization cleanup | `identifier` and `resource_url` are reusable after deletion through active-only indexes. |
| Agent identity | Soft delete plus credential and grant revocation | Explicit exception: issuer/subject and username remain permanently reserved. |
| Application | Hard delete by deleting its OAuth client; database cascades remove the Application | Application slug and OAuth client identity are released with the deleted rows. `disabled` is reversible state on the same Application, not deletion. |
| Organization | Hard delete with database cascades | Organization slug is released. `disabled` is reversible state on the same Organization. The built-in platform Organization is not deletable. |
| Connector | Guarded hard delete; rejected while Resource Servers reference it | Connector slug and provider identifier are released after deletion. Disabled Connectors retain the same identity. |
| Webhook endpoint | Hard delete with delivery-history cascade | No unique business key survives deletion; a new endpoint is independent. `enabled` is reversible state. |
| User | Hard delete after session cleanup | Username and email are released with the User row. Suspension is a separate reversible subresource. |
| Federated credential | Hard delete | The Application/issuer/subject tuple is released. `enabled` is reversible state. |
| Organization Role | Guarded hard delete with optimistic concurrency and audit | The Organization/role key is released when no assignment blocks deletion. |
| Organization member | Hard delete of the relationship | The Organization/User tuple is released and may be created again. |
| Organization invitation | Cancellation sets terminal status and `revoked_at` | Email is not unique; new invitations are allowed. The token hash remains permanent security history. |
| User, Application, and Agent Permission | Ended in place | Active-only partial indexes release the subject/resource/scope tuple after `ended_at`. |
| Application authorization/consent | Revoked in place | Active-only partial indexes release the principal/resource tuple after `revoked_at`. |
| Provider connection | Revoked in place and later reactivated/updated as the same durable relationship | Connector/owner uniqueness identifies one relationship; reconnect does not create a second historical owner relationship. |
| Provider Resource authorization and credential | Revoked in place and later reactivated/updated | Connection/Resource and credential-slot uniqueness identify the durable relationship. |
| Resource account connection | Revokes the durable Provider Resource authorization | A later connection reactivates or updates the same connection/Resource relationship instead of reassigning its identity. |
| Agent host binding | Revoked in place | Explicit stable-identity exception: one protocol installation cannot be reassigned to another Agent identity. |
| Linked sign-in account and wallet address | Hard unlink after sign-in-method safety checks | Provider/account and wallet tuples are released; the external credential itself is not reassigned by Realmroot. |
| Session and passkey | Hard delete | Relationship keys are released; old credential/token material is not reused. |
| TOTP MFA | Disables/removes the current factor | The User remains the same resource and may enroll a new factor when policy permits. |
| Agent activation and User suspension | DELETE removes a state subresource | The parent Agent/User remains the same resource and can be activated or suspended again. |

Custom Domains, device codes, access requests, connection intents, webhook
delivery attempts, tokens, and secrets do not currently expose deletion as a
replaceable primary-resource lifecycle. Their hostnames, codes, hashes,
sequence numbers, versions, and idempotency keys remain unique while the row is
retained because they are routing, replay-protection, credential, or audit
identities rather than reusable names.

## Revoked or ended records

Revocation, consumption, expiry, and disabling are audited lifecycle states,
but not every such row is a soft-deletable primary resource. Their keys follow
these explicit policies:

| Resource | Unique key policy |
| --- | --- |
| Agent identity binding | A protocol Agent installation is permanently bound to one stable identity, including after revocation. |
| Provider connection | One durable Connector relationship exists per owner; reconnecting updates that relationship instead of creating historical duplicates. |
| Provider resource authorization and credential | One durable authorization relationship and credential slot exist per Provider connection and Resource Server; reconnecting reactivates or replaces their state. |
| Application consent | Uniqueness is limited to active consent by partial indexes where `revoked_at is null`. |
| Resource scope entitlement | Uniqueness is limited to active entitlement by subject-specific partial indexes where `ended_at is null`. |
| Application client secret | `(application_id, version)` is immutable historical identity and remains permanently unique after revocation. |
| Invitations, access requests, token leases, OAuth tokens, refresh-token lineage, enrollment intents, webhook attempts | Tokens, hashes, sequence numbers, and idempotency keys are permanent security/audit identities and are never reused after completion, revocation, consumption, or expiry. |

Disabled or suspended Organizations, Applications, OAuth clients, Connectors,
federated credentials, and webhook endpoints are not tombstones. They retain the
same resource identity and can be re-enabled, so their unique keys continue to
identify that resource rather than a replacement.

## Delete result semantics

Resource Server deletion is one D1 batch containing the soft delete, dependent
authorization revocation, reference cleanup, and audit event. A batch failure
rolls back every effect. The first completed request returns `204`; a later retry
cannot resolve the deleted resource and returns `404 not_found`. Concurrent
attempts converge on the same deleted state without returning an internal error
after a committed mutation.
