# Agent Access Guide

Realmroot gives an Agent a stable identity and controller-approved access to
registered services without giving it a person's session or a permanent API
key. The Agent-facing model is intentionally small.

| Resource | Agent-visible meaning |
| --- | --- |
| Agent | Durable non-human identity with a stable issuer and subject. |
| Resource Server | Registered service, service URL, scope catalog, availability, and connection state. |
| Resource | Provider-owned object or authorization context exposed by one Resource Server. |
| Connection request | Request for the controller to link or expand the account used by a Resource Server. |
| Access request | Request for exact scopes on one Resource. |
| Resource credential | Short-lived DPoP credential held by the local adapter. |

Account-connection records, provider authorization details, scope Entitlements,
token leases, OAuth client records, refresh credentials, and private keys are
implementation details. They are never choices in the Agent workflow.

## 1. Establish The Agent

The first protected Restish operation starts a foreground enrollment:

1. The plugin generates Host and Agent proof keys locally.
2. Realmroot returns a controller interaction.
3. The plugin opens the supplied approval URL and waits.
4. Approval creates or binds the stable Agent.
5. The original operation resumes and returns the Agent issuer and subject.

The browser controller approves the relationship but never becomes the CLI
principal. State is keyed by Realmroot issuer and Agent runtime; profiles and
API aliases do not create additional identities.

## 2. Discover Resource Servers

`GET /api/resource-servers` is the top-level Agent inventory. Each item reports:

- the target `serviceUrl` and resource indicator;
- current RFC 9728 scope catalog with optional OpenAPI descriptions;
- `available` or `unavailable` contract state;
- `connected`, `not_connected`, or `not_required` account state;
- scopes held by the connected account;
- links to the Resource collection and connection-request collection.

Every returned `self` or collection link is dereferenceable. An unavailable
server remains visible with no requestable scopes, without hiding healthy
servers. Request and credential issuance revalidate the target contract and
fail closed if it changed.

Realmroot management authority is separate, controller-managed authority. It
does not grant access to a Resource Server and is not part of the Agent's
connection or access-request workflow.

## 3. Establish The Account Connection

External Resource Servers use at most one connected account for the Agent's
personal or organization home space. The Agent requests a connection by
Resource Server and scopes; it never selects a connection ID.

The controller may connect an account or expand the same account's scopes and
provider-owned Resources. Realmroot performs OAuth, PKCE, PAR, RAR, refresh,
and subject validation internally. Returning from OAuth completes the
connection request but does not itself approve Agent access.

Native Resource Servers report `not_required` and skip this step.

## 4. Select A Provider-Owned Resource

`GET /api/resource-servers/{resourceServerId}/resources` returns the Resources
the connected account makes visible. A Resource exposes display metadata and
two independent authority states:

- `accountAuthorization.status` says whether the controller's connected
  account covers the Resource;
- `agentAuthorization.authorizedScopes` and `requestableScopes` say what the
  Agent already has and may request.

The canonical Resource `links.self` is the input to an access request.
Provider-specific RFC 9396 objects remain server-side. A native Resource Server
normally exposes a single `service` Resource.

## 5. Request Exact Access

The Agent sends one Resource href, the union of scopes required by its current
task, and an optional reason to `POST /api/access-requests`. Least privilege is
task-level: exclude unrelated scopes, but do not split a known multi-operation
task into one access request per HTTP operation. Realmroot resolves the Resource
Server, provider authorization detail, account connection, and any reusable
grant.

If existing authority matches exactly, the request completes immediately.
Otherwise the controller chooses one-time, limited, or persistent approval on
the hosted consent page. That lifetime controls future credential requests;
every credential delivered to the Agent is still short-lived.

Capability, connection, and access requests use the same generic interaction
profile:

- `interaction.url` is the browser action;
- `links.self` is the polling resource;
- `Retry-After` is the polling interval;
- terminal states are completed, denied, expired, or failed.

The Restish plugin implements this protocol generically and has no endpoint
switch for individual workflows.

## 6. Obtain And Use A Short-Lived Credential

An approved access request includes a DPoP credential offer containing the
Resource href, resource indicator, credential endpoint, and proof target. The
plugin creates the DPoP key locally, obtains the short-lived credential, and
caches it by Resource. The Agent sees only a safe receipt.

The Agent reuses that credential across the task. It requests another one only
when it switches Resource, the credential expires or is rejected, or the task
requires an additional scope.

For native services, Realmroot signs an audience-bound `at+jwt`. For external
services, Realmroot exchanges controller and Agent authority at the target
authorization server. These differences are invisible to the Agent and
plugin.

The Agent then calls the Resource Server directly. The plugin adds
`Authorization: DPoP ...` and a fresh proof. Realmroot never proxies business
traffic.

The Resource Server validates issuer, signature, audience, expiry, operation
scopes, `cnf.jkt`, proof target and method, access-token hash, and replay. Roles,
groups, subject, and Agent actor claims may inform policy or audit but never
expand scope.

## 7. Recovery And Revocation

Revoking a Host stops only that installation. Retiring an Agent is permanent.
Revoking controller authority, a connection, or an internal grant stops new
credential issuance; active external leases are sent to the target revocation
endpoint when supported.

The plugin renews only through the stored generic credential offer. It removes
credentials rejected during renewal or by a target `401`, after which the
Agent must rediscover and request current access.

## Sources Of Truth

- [`skills/realmroot`](../../skills/realmroot/SKILL.md) for exact Restish procedures.
- `/api/openapi.json` for current operations and schemas.
- [Agent identity architecture](../architecture/agent-identity.md) for trust and storage boundaries.
- [Resource Server integration](../integrations/resource-servers.md) for publisher and validator requirements.
- [`specs/agent-identity.feature`](../../specs/agent-identity.feature) for behavior journeys.
