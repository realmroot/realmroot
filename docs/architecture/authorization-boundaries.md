# Authorization Boundaries

Realmroot is an identity provider and authorization server, but it is not the
business permission engine for every protected API. This document defines the
boundary between resource-owned permission semantics, Realmroot-managed
authorization facts, token issuance, and request enforcement.

## Decision

The resource server owns its business permission vocabulary and enforcement.
Realmroot discovers that vocabulary, references it in roles and grants, and
issues trustworthy claims about the approved authority. It does not maintain a
second permission catalog or decide whether a concrete business request may
proceed.

```text
Resource server code + OpenAPI
        |
        | defines scopes and operation requirements
        v
Realmroot discovery, roles, assignments, consent, and Agent grants
        |
        | issues exact scopes plus identity and policy context
        v
JWT or target-issued access token
        |
        | verified together with request and local data
        v
Resource server makes the final allow/deny decision
```

This avoids two independent permission definitions drifting apart. Changing an
operation's required authority starts in resource-server code and its OpenAPI
contract, not in Realmroot configuration.

## Four Separate Responsibilities

### 1. Permission Definition

The resource server defines:

- which business actions exist;
- the scope names that represent those actions;
- which OpenAPI operations require each scope;
- any finer object, tenant, ownership, state, or attribute rules;
- the final behavior when a request is allowed or denied.

Realmroot has no first-class business `Permission` resource. It does not create
scope strings or map them to endpoints. A scope mentioned only in Realmroot,
authorization-server metadata, descriptive text, or a custom extension is not
requestable.

The protected API publishes its scope vocabulary through standard OAuth or OIDC
security requirements in its OpenAPI contract. Realmroot follows the resource's
RFC 8631 `service-desc` link and derives the current requestable scope set from
that contract.

Realmroot's own management capabilities such as `applications:read` and
`api-resources:write` follow the same rule: Realmroot is the resource server for
its Resource API, so its code and `/api/openapi.json` own those definitions.
They authorize Realmroot administration only and never imply access to a
registered business API.

### 2. Authorization Facts And Approval

Realmroot manages facts that can be asserted about a principal:

- stable user, application, organization-member, and Agent identities;
- organization context and home-space ownership;
- roles assigned to those principals;
- user consent and exact OAuth scopes;
- controller-approved Agent access requests and grants;
- the target account connected to an external resource;
- grant lifetime, revocation, and audit history.

These records answer whether Realmroot may issue or broker a token containing a
requested scope. They do not answer whether a particular API request or object
is accessible at runtime.

### 3. Token Issuance

For a native API Resource, Realmroot is the authorization server. Agent access
validates the audience and requested scopes against the current resource
contract, applies the controller-approved grant boundary, and issues the exact
scopes with identity and policy context. Ordinary application OAuth currently
uses the application's scope allowlist and user consent; its known OpenAPI
revalidation gap is described below.

For an external API Resource, the target platform remains the authorization
server. Realmroot validates the Agent request against the target contract and
controller grant, then presents the connected user's subject token and stable
Agent actor token to the target. The target intersects their authority and
issues the final token.

Token issuance is therefore an authorization decision, but it is not the final
business request decision.

### 4. Request Enforcement

The resource server validates the token and decides whether to serve the actual
request. Depending on the mode, it uses the Realmroot or target issuer, but the
enforcement responsibility is the same:

- validate signature, issuer, audience, token type, expiry, and DPoP binding;
- require the scopes declared by the selected operation;
- interpret `sub`, `act`, `groups`, and `roles` according to local policy;
- evaluate local ownership, tenant, object, state, and attribute rules;
- deny by default when token or local policy is insufficient.

Realmroot-provided claims are inputs to this decision. They are not a remote
allow/deny call and do not replace resource-server policy.

## Realmroot Management Authorization

Realmroot's own control plane uses one authorization model for browser sessions
and delegated Agents. Authentication produces two values:

- an actor, which records the human user or stable Agent that performed the
  operation; and
- one owner boundary: the Realm, an exact set of Organizations, or one personal
  Account.

Every management operation has one canonical declaration containing its OAuth
scope, accepted authority kinds, and whether it requires a human controller.
Runtime checks, OpenAPI security, and authority-specific scope discovery all
consume that declaration. Collection queries apply the same owner boundary
before pagination that item routes apply before reads or mutations.

Account authority is exact. It covers resources owned by that Account and does
not inherit the user's Organization memberships. Organization authority covers
only the named Organization. Realm authority covers all management owners.
Browser-only consumer Organization relationships live below
`/api/account/organizations/{organizationId}` and verify membership directly;
they do not grant Developer Console or delegated management authority.

Agent self-service is a separate current-Agent resource tree below `/api/agent`.
It never changes representation based on credential type. For example,
`/api/agent/resource-servers` is Agent discovery while `/api/resource-servers`
is management inventory. This keeps bootstrap Agent scopes and management
authority scopes from sharing an ambiguous route.

Audit visibility follows the owner of the target Resource or selected
Realmroot authority, never the Agent that happened to perform the action. The
ownership migration recovers Account and Organization authority from durable
grants. Legacy Realmroot events that predate a recoverable grant do not contain
enough information to infer an owner safely; they remain Realm-only, are marked
`ownerResolution=legacy-authority-unresolved`, and are intentionally excluded
from Account and Organization audit feeds.

## Scope

A scope is a resource-owned protocol label for an approved class of actions. It
is not a complete permission model and does not identify a concrete object.

For example, a Documents API may declare:

```yaml
paths:
  /documents:
    get:
      security:
        - resourceOidc: [documents:read]
```

The API owns both `documents:read` and its relationship to `GET /documents`.
Realmroot may validate, approve, group, and issue that string, but it never
redefines what reading a document means. The API can still require that the
verified subject belongs to the document's organization or that the Agent actor
is allowed for that document's state.

OpenAPI remains authoritative at resource registration, role scope update,
Agent request, approval, and Agent grant token issuance boundaries. This makes
stale Agent scope references fail closed instead of turning Realmroot into
another editable scope registry.

## Role

A Realmroot role is a named set of references to scopes published by one API
Resource. It is a grouping and claim-management tool, not a new permission
definition.

Role scopes are validated against the resource's current OpenAPI contract. A
role cannot add a scope to a token by itself, and a role claim cannot expand the
token's `scope`. The resource server may use the role name as additional local
policy context, but it must continue to enforce the exact token scope.

Roles have optional context:

- `resourceId` binds the role to one API Resource and allows it to reference
  that resource's scopes;
- `organizationId` limits the role to one organization context;
- `applicationId` limits the role to one application context;
- no organization or application context means the role is global in that
  dimension, although it may still belong to one API Resource.

The role's resource and subject contexts are immutable after creation so an
existing assignment cannot silently change meaning.

### Assignment Subjects

The current model assigns roles to principals, not directly to an Organization:

| Subject | Allowed role context | Meaning |
| --- | --- | --- |
| User | No organization/application binding; optionally resource-bound | A role that follows the user across matching token contexts. |
| Application | Global or bound to that same application; optionally resource-bound | A role asserted for the client application principal. |
| Organization member | Global or bound to that same organization; optionally resource-bound | A role held by one user's membership in that organization. |
| Agent | Required API Resource binding; optionally bound to its home organization | A role asserted for or used to constrain that stable Agent. |
| Organization | Not assignable | Organization-wide policy is expressed through membership, Agent home space, group claims, or resource-local policy. |

This distinction matters because an organization membership is contextual: the
same user can have different roles in different organizations. Assigning a role
to the Organization itself would also encourage centralized organization-wide
business policy that the resource server may be better placed to own.

The Better Auth organization roles `owner`, `admin`, and `member` are a separate
governance system. They control who may administer the organization, its
members, and Agent identities. They are not API Resource roles and do not imply
business scopes.

Realmroot tenant administrator status and AgentAuth management capabilities are
also separate control-plane authority. Neither should be interpreted as access
to a protected business API.

## Current Role Semantics

Roles intentionally do not behave as an automatic centralized RBAC permission
engine:

- User, Application, and Organization Member assignments contribute matching
  `roles` claims for the selected resource and context. They do not add to or
  subtract from the OAuth scopes already approved for the token.
- An Agent with no matching resource role may request any scope currently
  declared by the resource OpenAPI contract and proceed to controller approval.
- Once one or more matching resource roles are assigned to an Agent, the union
  of their scopes becomes an additional eligibility ceiling on what that Agent
  may request.
- The controller-approved Agent grant still determines the exact scope set in
  the token. A role assignment alone cannot issue a token.
- The resource server may apply stricter local rules than either roles or
  scopes. Realmroot claims never require it to allow a request.

This asymmetry keeps roles optional. Teams can use them as reusable Agent scope
guardrails and standard claims without making every business authorization
change depend on a centralized role assignment.

## Known Implementation Boundary

Tracked by [GitHub issue #121](https://github.com/realmroot/realmroot/issues/121).

Application `allowedScopes` currently accepts custom scope strings as a client
request allowlist. Those strings do not define permissions or map scopes to
operations, and the resource server remains free to reject them. However,
ordinary application OAuth issuance checks the application allowlist and user
consent without revalidating a custom scope against the selected API Resource's
current OpenAPI contract.

This is a remaining drift boundary. It is narrower than a centralized
permission catalog, but it does duplicate resource-owned scope references. A
future change should associate custom application scopes with the requested
resource audience and validate or derive them from that resource's OpenAPI
contract. Until then, do not claim that every native OAuth scope is revalidated
against OpenAPI at issuance; that guarantee currently applies to Agent resource
grants.

## Native And External Resources

The ownership principle is the same in both modes; only the token issuer and
location of subject authorization differ.

| Responsibility | Native | External |
| --- | --- | --- |
| Scope names and operation mapping | Resource server OpenAPI | Resource server OpenAPI |
| User/application authorization | Realmroot consent and issuer policy | Target authorization server |
| Agent request and controller grant | Realmroot | Realmroot |
| Agent role eligibility ceiling | Realmroot, when roles are assigned | Realmroot, when roles are assigned |
| Final token issuer | Realmroot | Target authorization server |
| Object and request enforcement | Resource server | Resource server |

For external resources, Realmroot does not copy the target authorization
server's `scopes_supported` list into a local permission catalog. The connected
account establishes the user's target-side authority; the Agent grant establishes
the controller-approved subset; the target authorization server performs the
subject/actor intersection; and the resource server still makes the final
request decision.

## Consequences

- Resource-server code and OpenAPI must change together.
- Realmroot can reject stale scopes but cannot repair a stale resource contract.
- Roles remain references to resource-owned scopes rather than editable
  permissions.
- Realmroot owns issuance policy and auditable delegation, not object-level
  access policy.
- Resource servers must not treat `roles`, `groups`, `sub`, or `act` as expanding
  the granted `scope`.
- A token can be valid and still be denied by resource-local policy.
- Removing a scope from OpenAPI stops new role-scope updates and Agent requests,
  approvals, and grant token issuance for that scope. Existing short-lived
  tokens remain governed by expiry, revocation, and resource-server policy.

## Related Documents

- [Auth provider architecture](auth-provider.md)
- [Agent identity architecture](agent-identity.md)
- [Resource server integration](../integrations/resource-servers.md)
- [Agent access guide](../guides/agent-access.md)
