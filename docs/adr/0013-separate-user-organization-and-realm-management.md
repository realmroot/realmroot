# 0013 — Separate User, Organization, and Realm management

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

A Realm User can belong to several Organizations with different Roles, while
Realm operators administer the shared issuer and user pool. Treating a selected
Organization in Console navigation as an authorization boundary mixed personal,
Organization, and platform responsibilities and made browser state look
authoritative.

## Decision

Use three management surfaces with distinct responsibility:

- Account Center manages the signed-in User's identity, security, personal
  resources, memberships, and invitations.
- Organization Workspace under `/organizations/:organizationId/*` manages one
  Organization and its owned resources.
- Realm Console under `/console/*` manages Realm-wide identity, infrastructure,
  policy, and cross-Organization inventory and requires platform authority.

The server authorizes every operation. Route visibility, navigation, and owner
filters never grant authority.

Durable resources are Realm-global, owned by exactly one User or Organization,
inherit the owner of exactly one parent, or explicitly relate independently
owned resources. Mutation actor, audience, visibility, and eligibility are not
ownership. Applications and Resource Servers are Organization-owned; Agent
identities and external resource account connections have exactly one User or
Organization owner.

## Consequences

- Organization membership never grants Realm Console access.
- Organization management uses stable nested routes without a Console context
  switch.
- User identity and security remain Realm-global even when the User belongs to
  Organizations.
- Capability-owned frontend modules can be composed by Organization Workspace
  and Console without making Console the owner of the business capability.
- Tenant authorization requires both the target tenant and required scope.

## Alternatives considered

- Keep an Organization switcher in Realm Console: rejected because it mixes
  platform authority with Organization membership.
- Put Organization management into one Account Center tab: rejected because
  the resources are independent, linkable capabilities.
- Duplicate Organization management under Console: rejected because it creates
  competing canonical surfaces.

## References

- [Resource ownership inventory](../../server/domain/resource-ownership.ts)
- [Authorization context](../../server/domain/authorization-context.ts)
- [Account Center specification](../../specs/account-center.feature)
- [Admin Console specification](../../specs/admin-console.feature)
- [Management API specification](../../specs/management-api.feature)
