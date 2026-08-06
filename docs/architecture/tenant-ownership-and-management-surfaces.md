# Tenant Ownership And Management Surfaces

Status: accepted; Part One implemented, Part Two implemented by the backend ownership migration

## Context

Realmroot has one Better Auth user pool and one issuer per deployment. A User is
therefore a Realm identity, not a record copied into each Organization. A User
may join multiple Organizations through separate memberships and may have
different Roles in each Organization.

The current browser Console combines two responsibilities:

- Realm-wide platform administration;
- Organization administration selected through a `context` query parameter.

That context switch makes navigation state look like an authorization boundary,
mixes Realm and Organization resources in the same feature modules, and leaves
Organization members dependent on a surface named Console even when they have
no platform authority. The Account Center already has an Organization detail
page, but it implements only part of the Organization management lifecycle and
uses component-local tabs rather than durable nested routes.

The persistence model also contains records where resource owner, audience,
and mutation actor are not expressed as separate concepts. The browser change
must establish the intended product boundary before the backend model is
normalized.

## Decision

Realmroot will expose three management surfaces with one responsibility each:

1. **Account Center** manages the signed-in User's identity, security, personal
   resources, memberships, and invitations.
2. **Organization Workspace** manages exactly one Organization and the resources
   owned by that Organization. Better Auth Organization Roles authorize human
   members inside this surface.
3. **Console** is a Realm platform-administration surface. Only Realm platform
   administrators may enter it. It has no Organization context switch.

The surfaces are presentation and navigation boundaries. Server authorization
remains authoritative. Hiding a link or moving a route never grants authority.

```text
Realmroot deployment
├── Account Center                         User boundary
│   ├── profile and authentication
│   ├── personal Agents and connections
│   └── Organization memberships
├── Organization Workspace /organizations/:organizationId/*
│   ├── members, invitations, and Roles
│   ├── Applications and Resource Servers
│   ├── Organization Agents and connections
│   ├── Webhooks and audit activity
│   └── Organization settings
└── Console /console/*                     Realm platform boundary
    ├── global identity and tenant inventories
    ├── global authentication infrastructure
    ├── Realm policy, security, and experience
    └── deployment and operational settings
```

## Tenant Model

The user pool and the resource tenancy model are deliberately different:

- `user` is a Realm-global identity record;
- `member` is an Organization-owned projection that connects a User to an
  Organization;
- a User tenant is the personal authorization boundary for self-owned resources;
- an Organization tenant is the shared authorization boundary for Organization
  resources;
- Realm is a platform authority boundary, not another tenant.

An Organization may change a member's Organization Roles, title, invitation,
and membership lifecycle. It does not own or mutate the User's Realm email,
password, MFA factors, passkeys, sessions, linked identities, or other personal
security data.

The canonical authorization decision remains:

```text
authorization-context tenant equals target-resource tenant
and
authorization-context contains the operation's required scope
```

For a human User, Better Auth Organization Roles resolve to scopes independently
for the target Organization. Agents, Applications, and workloads receive
tenant-bound scopes directly and never receive human Roles.

## Resource Ownership Classification

Every durable resource must be one of four shapes:

1. a Realm-global identity or platform record;
2. a tenant aggregate root with exactly one User or Organization owner;
3. a child resource that inherits the tenant of exactly one parent;
4. an explicit relationship between two independently owned resources.

`createdByUserId`, audience, eligibility, and visibility are not ownership.

| Resource family | Canonical boundary | Ownership rule |
| --- | --- | --- |
| User, credentials, sessions, MFA, passkeys, linked accounts, wallets | User | Realm identity stored once; self or platform administration only |
| Organization, membership, invitation, Role definition and assignment | Organization | `organizationId` is mandatory |
| Application, client secrets, redirect URIs, federated credentials | Organization | Application has one owning Organization; children inherit it |
| Resource Server and its discovered scope catalog | Organization | Resource Server has one owning Organization; eligibility does not change owner |
| Agent identity | User or Organization | exactly one owner; bindings, enrollment, requests, grants, and leases inherit it |
| External resource account connection | User or Organization | exactly one owner; initiation actor is recorded separately |
| Organization Webhook and delivery history | Organization | delivery and attempts inherit the endpoint tenant |
| Realm Webhook | Realm | platform operations only; never exposed as an Organization resource |
| Branding | Realm | unchanged shared presentation settings |
| Audit event | inherited and materialized | persist the affected resource tenant at event creation |
| Application consent | User | the authenticated User and Application identify the consent; Organization Roles are irrelevant |
| identity providers, sign-in policy, email, security, deployment, issuer keys | Realm | shared infrastructure for the complete user pool |

Applications and Resource Servers remain Organization-owned in this decision.
Supporting personal developer-owned Applications later would require an
explicit User-owner variant and its own product journey. It must not be modeled
through a nullable owner or an implicit platform Organization.

## Management Surface Responsibilities

### Account Center

Account Center remains the home for:

- personal profile and security;
- personal authorized Applications and consent revocation;
- personal Agent identities and grants;
- Organization membership inventory and invitations;
- entry into an Organization Workspace.

The Account Center top-level Console action is shown only to Realm platform
administrators. Organization membership never implies Console access.

### Organization Workspace

The current `/organizations/:organizationId` page becomes a route shell with
durable nested navigation:

```text
/organizations/:organizationId/overview
/organizations/:organizationId/members
/organizations/:organizationId/roles
/organizations/:organizationId/agents
/organizations/:organizationId/applications
/organizations/:organizationId/resource-servers
/organizations/:organizationId/webhooks
/organizations/:organizationId/activity
/organizations/:organizationId/settings
```

The unqualified `/organizations/:organizationId` route redirects to `overview`.
The Organization list remains at `/organizations` in Account Center.

Navigation items may be hidden when the resolved Organization scopes cannot
authorize any operation in that section. Direct navigation must still load the
route and rely on the server response as the final authorization decision.

Recommended navigation groups:

- **Organization:** Overview, Members, Roles;
- **Develop:** Applications, Resource Servers, Agents, Webhooks;
- **Governance:** Activity;
- **Configuration:** Settings.

Short create and edit operations remain in dialogs or sheets. Long or linkable
configuration uses a nested secondary route. Primary pages remain inventory and
operation surfaces.

### Realm Console

`/console` requires Realm platform-administrator authority. Organization Roles
and `consoleOrganizations` do not grant entry.

The Console shell removes:

- the Organization switcher;
- the `context` query parameter;
- `ConsoleScopeProvider` and Organization-dependent navigation filtering;
- propagation of `context` through links, breadcrumbs, search, and loaders;
- the Organization-scoped Roles inventory.

The Console retains Realm-wide operational views:

- dashboard and readiness;
- global Users, Organizations, Agents, Applications, Resource Servers, and
  Webhooks inventories;
- identity providers;
- sign-in and registration experience;
- security policies;
- Realm branding and Account Center defaults;
- Realm and deployment settings.

`/console/organizations` remains a platform inventory. Selecting an Organization
opens its canonical Organization Workspace. The old
`/console/organizations/:organizationId/*` route family redirects to the
corresponding `/organizations/:organizationId/*` route during the supported
navigation transition and is then removed when repository compatibility policy
allows it.

Realm-wide inventories are not Organization management pages. They support
platform discovery, incident response, disablement, and cross-tenant oversight.
Ordinary Organization mutation remains in the Organization Workspace.

## Frontend Module Ownership

Organization and resource behavior must not be moved from `features/console`
into `features/account`. Both names describe surfaces rather than the business
capabilities being managed.

The frontend migration will establish capability-owned modules:

```text
src/features/
  organizations/       shell, overview, membership, Roles, settings
  applications/        Application inventory and detail operations
  resource-servers/    Resource Server inventory and detail operations
  agents/              Agent inventory and lifecycle operations
  webhooks/             endpoint and delivery operations
  account/              personal Account Center composition
  console/              Realm platform composition
```

Organization and Console routes compose the public API of those features with
an explicit query boundary:

- Organization route supplies one `ownerOrganizationId` and tenant-scoped
  operations;
- Console route supplies Realm inventory mode and requires platform authority.

Feature components do not read a global Console context. Tenant identity comes
from the route parameter and is passed explicitly into feature operations.

## Implementation Sequence

### Part One: Browser Surfaces

1. Update behavior specifications for Console platform-only access and the
   Organization Workspace journeys.
2. Introduce the Organization route shell and nested route inventory.
3. Move existing Account Center Organization behavior into the Organization
   feature without changing server contracts.
4. Extract Organization-owned Applications, Resource Servers, Agents, Webhooks,
   and Roles from Console-owned components into capability modules.
5. Make `/console` platform-only and remove all context switch state and link
   propagation.
6. Keep Realm inventory pages in Console and point Organization drill-down to
   the Organization Workspace.
7. Remove obsolete Organization Console components, context helpers, search
   state, tests, and copy.

Part One is complete. Capability modules now own Applications, Resource
Servers, Agents, Webhooks, and Roles; Organization routes pass their
`organizationId` explicitly; and Console no longer provides or consumes an
Organization context. The public HTTP contract remains unchanged by this
module-boundary refactor.

Part One does not redesign the server ownership schema. The backend ownership
work below is intentionally isolated in a follow-up pull request.

### Part Two: Backend Ownership Normalization

After the browser boundary is stable:

1. establish a machine-readable resource ownership inventory;
2. materialize and constrain tenant identity for ambiguous aggregate roots;
3. make child resources inherit tenant through one canonical parent;
4. separate owner, mutation actor, audience, and eligibility fields;
5. correct audit, consent, connection-intent, and platform-resource ambiguity;
6. require collection, item read, write, delete, and audit queries to use the
   same owner boundary;
7. migrate live data with explicit validation, quarantine, and fail-closed
   handling for records whose tenant cannot be proved.

Part Two uses a one-way D1 table rebuild. Runtime code supports only the final
schema: it does not dual-read or infer legacy ownership. Historical audit rows
whose boundary cannot be proved are quarantined. Branding remains Realm-owned,
and Custom Domain is outside this decision because it has no exposed product
lifecycle.

## Verification

Part One requires executable proof for:

- a non-platform Organization Owner cannot enter `/console`;
- a Realm platform administrator can enter `/console`;
- the Console has no context switch or `context` URL state;
- Organization routes survive direct navigation, reload, back, and forward;
- each Organization section loads only its route Organization;
- Role-based navigation visibility matches server-returned scopes without being
  treated as authorization enforcement;
- platform inventory drill-down reaches the canonical Organization route;
- desktop and narrow navigation are keyboard accessible and restore focus;
- existing Account Center personal journeys remain unchanged.

Proof belongs at the cheapest complete layer: feature and route behavior in the
web unit suite, real router and D1 authorization wiring in integration tests,
and a small E2E journey for platform denial plus Organization navigation.

## Consequences

- Organization administrators receive a first-class product workspace without
  gaining platform Console authority.
- Realm operators use one stable Console context and no longer depend on URL
  search state for authorization-sensitive filtering.
- Organization-owned feature code becomes reusable by its two legitimate
  compositions without importing Console internals into Account Center.
- The route inventory grows, but every Organization management state becomes
  linkable, reloadable, and testable independently.
- Backend ownership ambiguity remains visible and intentionally deferred to a
  separate data-model change rather than being concealed by UI filtering.

## Rejected Alternatives

### Keep the Console switcher and improve its labels

Rejected because navigation context would still combine Realm authority and
Organization membership in one surface and one module graph.

### Put all Organization management into one Account Center tab component

Rejected because Applications, Resource Servers, Webhooks, Agents, Roles, and
audit history are independent, linkable capabilities. Component-local tab
state would not survive reload or produce stable route ownership.

### Create a second Organization-only Console

Rejected because it would duplicate the same resource representations and
preserve Console as a misleading authorization concept. Organization Workspace
is the canonical Organization surface.

## Related Documents

- [Tenancy model](tenancy.md)
- [Authorization boundaries](authorization-boundaries.md)
- [Frontend reimplementation tracker](../product/frontend-reimplementation.md)
