# Agent Access Guide

This guide explains how a Realmroot Agent becomes a durable principal and gains
least-privilege access to Realmroot administration and protected business APIs.
It is for product engineers, resource-server authors, and the people who
control Agents. The live OpenAPI contract owns endpoint details, while the
Realmroot skill owns exact Restish procedures.

## The Product Model

Realmroot exposes stable product resources instead of its protocol and secret
storage records:

| Resource | Purpose |
| --- | --- |
| Agent | Durable non-human identity with an immutable issuer and subject. |
| Agent enrollment | Controller-approved binding of a Host registration to an Agent. |
| API Resource | Protected business API, its resource URL, authorization mode, and discoverable contract. |
| Account connection | Encrypted external-account authorization owned by one personal or organization home space. |
| Access request | Exact Agent, API Resource, optional account, scope set, reason, and pending controller decision. |
| Access grant | Approved one-time, limited, or persistent authority derived from an access request. |
| Audit event | Non-secret record of enrollment, approval, issuance, denial, or revocation. |

Host credentials, identity bindings, OAuth connection intents, target OAuth
client records, refresh credentials, token leases, and DPoP private keys are
implementation details. They are not public management resources and must not
be copied into chat, logs, or application configuration.

## 1. Establish A Stable Agent

The first protected Restish operation starts a foreground, device-style
enrollment flow:

1. The adapter generates Host and Agent proof keys locally and registers the
   protocol Agent.
2. Realmroot opens a hosted verification page for an authorized controller.
3. Approval creates a stable Agent in a personal or organization home space
   and binds the current Host registration to it.
4. The original operation resumes as the Agent and returns its stable issuer
   and subject.

The controller's browser session approves the relationship; it never becomes
the CLI request principal. Enrollment grants only the Agent's default
self-service authority. It does not grant Realmroot administration or access to
any business API.

Local identity state is keyed by the discovered Realmroot issuer and Agent
runtime. API aliases, Restish profiles, and individual runtime sessions reuse
that identity. A different issuer or different Agent runtime gets separate
local identity state. Multiple Hosts may be bound to the same Agent without
sharing private keys.

## 2. Choose The Authority Boundary

Realmroot deliberately separates its own control plane from protected business
APIs.

### Realmroot Management

Each protected Resource API operation publishes a management capability such
as `{resource}:read` or `{resource}:write`. The Agent requests the missing
capabilities through the AgentAuth approval flow. Approval changes what the
Agent may administer in Realmroot; it does not issue a business API token or
allow the Agent to impersonate its controller.

### Business API Access

The Agent lists available API Resources, connects directly to a candidate
resource URL, and reads the target OpenAPI operation. The target contract's
OAuth or OIDC security requirements are authoritative for requestable scopes.
Realmroot does not maintain a second scope catalog.

A contract discovery failure marks only that resource `unavailable` with no
requestable scopes. Other resources remain discoverable. Request, approval, and
issuance revalidate the selected contract and fail closed if it is unavailable
or no longer declares the requested scopes.

The Agent then creates one access request for the exact scopes required by the
task. A controller confirms the resource, scopes, account when applicable, and
grant lifetime. Expanding scopes, changing resource, or changing external
account requires another decision.

Resource roles may restrict eligible scopes when roles are assigned. A
roleless Agent may still request scopes declared by the target contract and
proceed to controller approval.

## 3. Native And External Issuance

Both authorization modes share discovery, access requests, controller
decisions, grants, DPoP binding, revocation, and audit. They differ only at the
token issuer boundary.

| | Native API Resource | External API Resource |
| --- | --- | --- |
| Authorization server | Realmroot | Target platform |
| Account connection | None | One connected account per resource and home space |
| Subject | Controlling user or organization | Connected target user |
| Agent actor | Stable Agent in RFC 8693 `act` | Stable Agent in target-issued `act` |
| Token | Realmroot-signed five-minute `at+jwt` | Short-lived target-issued DPoP token |
| Refresh credential | Not used | Encrypted by Realmroot and never returned to the Agent |

For native resources, Realmroot signs an audience-bound token containing only
the approved scopes, effective resource roles, applicable organization group,
the stable Agent actor, and the DPoP key thumbprint.

For external resources, a controller first connects the home space's target
account with authorization code and S256 PKCE. Realmroot refreshes that user's
subject token, obtains an Agent actor token with the RFC 7523 JWT bearer grant,
and exchanges the subject and actor tokens with RFC 8693. The target
authorization server intersects user and Agent authority and issues the final
DPoP-bound token.

Each home space has at most one connected account for an external API Resource.
If its authorization does not cover a pending request, approval is blocked
until the controller reauthorizes the same target subject. Realmroot preserves
the connection identity and replaces its encrypted credentials and scopes;
returning from OAuth does not approve the Agent request itself.

## 4. Call The Resource Directly

The Restish adapter creates a separate DPoP key for each approved resource
grant, submits a token-endpoint proof, and stores the returned short-lived token
in protected local state. Only the current grant credential for a resource is
retained: a replacement grant gets a new DPoP key and removes the obsolete
binding. The adapter removes the raw token from command output.

The Agent invokes the operation on the protected resource URL. The adapter adds
`Authorization: DPoP ...` and a fresh request proof. Business traffic does not
pass through Realmroot.

The resource server validates issuer, signature, token type, audience, expiry,
operation scopes, `cnf.jkt`, proof target and method, access-token hash, and
proof replay. It may use `roles`, `groups`, `sub`, and `act` as policy or audit
context, but those claims never expand `scope`.

## 5. Display, Recovery, And Revocation

Resource servers may discover Realmroot's public `agentinfo_endpoint` and
resolve the verified `(act.iss, act.sub)` pair to an Agent name and picture.
AgentInfo is cacheable display metadata only. It contains no controller, home
space, Host, role, scope, grant, or authorization state and must never decide
whether a request is allowed.

Revoking one Host stops that Host without revoking the stable Agent or its other
Hosts. Recovery preserves the Agent subject but revokes current Host bindings,
sessions, and resource authority; replacement Hosts and authority require new
controller decisions. Retirement is permanent and reserves the subject for
historical audit.

Revoking an Agent, Host, grant, account connection, or credential stops new
issuance. Realmroot also sends active external token leases to the target's RFC
7009 revocation endpoint. The adapter removes obsolete local resource
credentials after expiry or when Realmroot rejects an inactive grant.

## Sources Of Truth

- Install and invoke [`skills/realmroot`](../../skills/realmroot/SKILL.md) for
  current setup, discovery, approval, and invocation procedures.
- Read the deployment's `/api/openapi.json` for current operations, schemas,
  and management capabilities.
- Read [Agent identity architecture](../architecture/agent-identity.md) for
  identity, trust, storage, and token boundaries.
- Read [Resource server integration](../integrations/resource-servers.md) to
  publish a compatible API and validate tokens and DPoP proofs.
- Read [`specs/agent-identity.feature`](../../specs/agent-identity.feature) for
  the complete behavior journeys.
