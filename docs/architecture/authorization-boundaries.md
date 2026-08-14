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
Resource server metadata + code + OpenAPI
        |
        | advertises scopes and defines operation requirements
        v
Realmroot discovery, Organization Roles, consent, and Agent grants
        |
        | issues exact scopes plus identity and policy context
        v
JWT or target-issued access token
        |
        | verified together with request and local data
        v
Resource server makes the final allow/deny decision
```

This avoids a Realmroot-owned permission definition drifting away from the
resource. Scope names start in protected-resource metadata, while an operation's
required authority starts in resource-server code and its OpenAPI contract.
Realmroot rejects operation mappings to scopes the resource did not advertise.

## Four Separate Responsibilities

### 1. Permission Definition

The resource server defines:

- which business actions exist;
- the scope names advertised through RFC 9728 protected-resource metadata;
- which OpenAPI operations require each scope;
- any finer object, tenant, ownership, state, or attribute rules;
- the final behavior when a request is allowed or denied.

Realmroot has no first-class business `Permission` resource. It does not create
scope strings or map them to endpoints. A scope absent from the Resource
Server's RFC 9728 `scopes_supported` metadata is not requestable.

The protected API publishes its scope vocabulary through RFC 9728
`scopes_supported`. Realmroot derives the current requestable scope set from
that metadata and follows the RFC 8631 `service-desc` link for optional
descriptions and operation mappings.

Realmroot's own management capabilities such as `applications:read` and
`api-resources:write` follow the same rule: Realmroot is the resource server for
its Resource API, so its code and RFC 9728 metadata own those definitions;
`/api/openapi.json` maps them to management operations.
They authorize Realmroot administration only and never imply access to a
registered business API.

### 2. Authorization Facts And Approval

Realmroot manages facts that can be asserted about a principal:

- stable user, application, organization-member, and Agent identities;
- organization context and home-space ownership;
- Better Auth Roles assigned only to human Organization memberships;
- user consent and exact OAuth scopes;
- controller-approved Agent access requests and grants;
- the target account connected to an external resource;
- grant lifetime, revocation, and audit history.

These records answer whether Realmroot may issue or broker a token containing a
requested scope. They do not answer whether a particular API request or object
is accessible at runtime.

### 3. Token Issuance

For a native API Resource, Realmroot is the authorization server. Agent access
validates the audience and requested scopes against the current scope registry,
applies the controller-approved grant boundary, and issues the exact
scopes with identity and policy context. Ordinary application OAuth uses the
application's scope allowlist and user consent against the same synchronized
registry.

For an external API Resource, the target platform remains the authorization
server. Realmroot validates the Agent request against the target scope registry
and controller grant, then presents the connected user's subject token and stable
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

RFC 9728 protected-resource metadata remains authoritative at resource
registration and scope synchronization. The synchronized registry governs role
scope updates, Agent requests, approvals, and token issuance, while OpenAPI may
add descriptions and maps operations only to advertised scopes.

Registries created by older OpenAPI-based discovery are cleared by migration.
New registries are populated only after successful RFC 9728 discovery.

## Organization Role

Better Auth Organization RBAC is Realmroot's only Role system. A Role belongs
to exactly one Organization and is assigned only to human memberships through
Better Auth's `member.role` field. A User may hold multiple Roles in one
Organization and a different set in another Organization.

Static `owner`, `admin`, `developer`, and `member` Roles are defined in code.
Dynamic Roles are stored in Better Auth `organizationRole`. Both map to the same
tenant-bound scope set. External Resource Server scopes are stored as encoded
`{resourceId, scope}` keys after Realmroot verifies the resource, current RFC
9728 scope catalog, and Organization eligibility.

Roles are never assigned to Agents, Applications, or workloads. Those actors
receive exact scopes directly from grants, consent, or token exchange. The
common runtime decision is therefore:

```text
authorization context tenant equals target tenant
and
authorization context contains the required scope
```

A User tenant has no Role concept; its owner receives only self scopes. Realm
administrator status is a platform permission and is not another tenant.

Role definitions and member Role replacement use the Realmroot Organization
facade so validation and audit persistence commit atomically. Better Auth's
native Role mutation endpoints are not public mutation paths.

## Native And External Resources

The ownership principle is the same in both modes; only the token issuer and
location of subject authorization differ.

| Responsibility | Native | External |
| --- | --- | --- |
| Scope names | Resource server RFC 9728 metadata | Resource server RFC 9728 metadata |
| Operation mapping and descriptions | Resource server OpenAPI | Resource server OpenAPI |
| User/application authorization | Realmroot consent and issuer policy | Target authorization server |
| Agent request and controller grant | Realmroot | Realmroot |
| Agent scope boundary | Realmroot controller-approved grant | Realmroot controller-approved grant |
| Final token issuer | Realmroot | Target authorization server |
| Object and request enforcement | Resource server | Resource server |

For external resources, Realmroot copies the protected resource's RFC 9728
`scopes_supported` list into its synchronized scope registry; it does not use
the target authorization server's global `scopes_supported` list. The connected
account establishes the user's target-side authority; the Agent grant establishes
the controller-approved subset; the target authorization server performs the
subject/actor intersection; and the resource server still makes the final
request decision.

A compatibility Adapter occupies the external target boundary: it implements
the target authorization server and protected Resource, issues the final DPoP
token, retains provider credentials, and forwards published operations to the
external provider. It does not create a third authorization model. The normative
ownership and extension constraints are defined in
[Provider Adapter Boundary](provider-adapter-boundary.md).

## Consequences

- Resource-server RFC 9728 metadata, code, and OpenAPI operation mappings must change together.
- Realmroot can reject stale scopes but cannot repair a stale resource contract.
- Organization Roles remain references to resource-owned scopes rather than
  editable permission vocabularies.
- Realmroot owns issuance policy and auditable delegation, not object-level
  access policy.
- Provider-specific OAuth, credentials, scope translation, API proxying, and
  lifecycle semantics never move into Realmroot core code.
- Resource servers must not treat `roles`, `groups`, `sub`, or `act` as expanding
  the granted `scope`.
- A token can be valid and still be denied by resource-local policy.
- Removing a scope from protected-resource metadata stops new role-scope updates and Agent requests,
  approvals, and grant token issuance for that scope. Existing short-lived
  tokens remain governed by expiry, revocation, and resource-server policy.

## Related Documents

- [Auth provider architecture](auth-provider.md)
- [Agent identity architecture](agent-identity.md)
- [Resource server integration](../integrations/resource-servers.md)
- [Agent access guide](../guides/agent-access.md)
