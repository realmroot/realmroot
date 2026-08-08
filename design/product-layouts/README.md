# Realmroot complete product layouts

This interactive artifact applies the selected **C · Clear Aqua** design system
to Realmroot's four user-facing surfaces.

- Console: separate Realm and Organization contexts plus application, user,
  organization, Agent, Resource server, and role detail layouts.
- Hosted Auth: 12 real authentication, consent, Agent, callback, and onboarding
  journeys.
- Account Center: overview, profile, sign-in and security, applications,
  delegated Agents, authorization activity, and organization management.
- Public Profiles: externally browsable User and Agent identity pages with
  verifiable public claims and privacy-conscious information boundaries.

Public User profiles use only display-safe identity fields and activity attributed
to the User as controller. Public Agent profiles map identity and activity to the
stable Agent subject. Both variants use a
GitHub-inspired annual heatmap and a recent activity timeline. Private activity
may contribute anonymized counts, but never exposes its Resource, grant, scope,
Host, controller, or authorization details. Public profiles remain display metadata,
never an authentication or authorization decision.

The User profile intentionally focuses on Public Agents and Recent activity; the
streak overview and annual heatmap are reserved for Agent profiles. The User
mockup also explores an opt-in public “Links & identities” projection.
The current linked-account record only contains `providerId` and `accountId`,
and the current User profile has no website field. Production support therefore
needs explicit public link metadata and a safe provider profile URL/display-name
projection; credentials and provider tokens must never enter the public model.

The Agent Owner link and the User's Public Agents section are public projections.
Publishing ownership must
be explicit and must not expose or imply the Agent's controller, Host, grants,
scopes, or current authorization state.

Open `index.html` directly or serve the repository and visit
`/design/product-layouts/`.

The information architecture was reconstructed from the current frontend
routes, page components, and behavior specs. Forms are intentionally shown in
drawers or task-focused authentication pages rather than mixed into primary
browsing pages.

Decision surfaces use one divider per information group and balanced
Deny/Approve actions. Actions are equal-width on desktop and stacked with
approval last on mobile.

Resource grants treat scopes as an unbounded collection in a compact scroll
region. Time-limited grants reveal an explicit expiration date only when that
lifetime is selected.

OAuth consent presents human-readable capabilities first. Protocol scopes stay
available in collapsed technical details, while the primary decision remains
the familiar Cancel/Allow pair.

Console has two explicit working contexts over one shared inventory. Realm contains
the user pool, issuer, authentication policy, hosted experience, Organization inventory,
and deployment settings. Organization context preselects that Organization in the
Users filter and as Owner in Agents and Develop; it does not replace those pages,
columns, or actions with Organization-specific variants. Authorized users can change
or clear the filters. Token claims remain application-scoped, and Account Center
remains a complete product surface.

Hosted experience color schemes and brand assets are marked as Pro capabilities.
Realm URL, browser trust, email sender identity, authentication policy, and
Provider credentials are managed in Console. Deployment remains a read-only
operational view of the runtime and public protocol endpoints.

Realm Console groups identity, development resources, authentication, and Realm
administration. Organization context uses the same Users, Agents, Applications,
Resource servers, and Roles pages with visible default filters, and appears only
when the Realm Developer policy and member access level allow it. The topbar context
switch changes defaults and available navigation, not the underlying inventory.
API and help links remain in the utility footer.

Console navigation separates technical definitions from authority. Develop contains
Applications, Resource servers, and Webhooks. Authorization contains the Realm-global
Roles catalog and a cross-Role assignments inventory. Configuration contains only
Experience and Settings. The Role assignments page complements each Role detail Tab
with a subject-first, Context-filterable view across the Realm.

Console detail pages continue the list-page heading rhythm with a single object
heading, parent breadcrumb, stable identifier, and type or status. Their content
uses flat divided sections instead of repeating the object in a bordered card.
Every first-class detail page now uses the same compact header and single-column
Overview standard. Agent details separate Hosts from requests and grants; User
details use tables for sessions and authorized apps. Application details adapt to
client type: this Web application keeps OAuth and Token claims together, moves
Audience into Settings, adds an Authorizations inventory, and omits per-Application
Consent customization and workload Credentials. Organization details separate
members and Agents without duplicating Applications or Resource servers; Role details
separate OpenAPI scopes and assignments.
Application configuration Tabs remain read-only. Each editable Section has at most
one header-aligned Edit action that opens an atomic drawer. Rotate, Revoke, Disable,
and Delete are the only independent row operations. A fixed label/value/action grid
prevents values from shifting when a row has no action.
Edit actions open drawers, while Settings is reserved for access eligibility, recovery,
and lifecycle operations rather than repeating read-only metadata.
Organization creation and Developer access are orthogonal Realm policies.
Account Center visibility is derived from memberships, pending invitations, and
creation permission rather than a separate switch. A consumer-facing family
Organization can support membership and shared authorization without exposing any technical resource UI.
Console inclusion does not add a column or relation table to Better Auth's
Organization model. Selected-organizations mode uses the namespaced
`metadata.realmroot.console.enabled` annotation; effective access also requires
the Realm policy and an eligible member access level.
Organization Access Levels govern Organization administration without granting
business API scopes. Agents are identities belonging to either a User or an
Organization; they are established through Agent enrollment and never created
manually from Console. Roles are reusable Realm-global permission definitions and
can include scopes from multiple Resource servers. Assignments bind a Role to a User,
Agent, or workload identity either Realm-wide or within one Organization context.
OAuth consent, contextual Role assignments, and Agent access grants remain separate
rather than becoming one generic authorization object. Role details keep one
filterable Permissions table with a Resource server column, plus Context-filtered
assignments and audit activity. New Role creates metadata only; permission changes
use a dedicated selector from the detail page.
Tabs with only one content section render their rows or table directly without a
second title and description. Flat row groups omit outer top and bottom borders.

Resource server details treat the object as an authorization boundary rather
than a generic settings record. Overview is a single-column operational summary.
Scopes owns the synchronized registry and each scope's grant mode. Endpoints owns
the protected OpenAPI operation inventory and required scope sets. Roles and direct
grants remain below their owning Organization, User, Application, or Agent instead
of being aggregated on the Resource server. External authorization details appear
in Overview. Resource metadata is edited from the detail-page action; Settings
contains only visibility, availability, and deletion.

Ownership, access eligibility, and authority are deliberately separate. A
developer-enabled Organization can own an application or API while making it
available to every Realm user. Audience or access eligibility answers who may request it;
Role assignments and Agent access grants answer what an eligible actor may do.

Account Center is the self-service entry point for creating, joining, switching,
and managing Organizations when Realm policy allows it. The creator becomes Owner.
Organization profile and membership remain accessible independently. Open Console is
shown only when both the Realm Developer policy and the member's access level allow
technical resource management.

First-admin onboarding creates a private platform Organization. Realm operators can
use it as the explicit owner for platform Applications and APIs without granting
ordinary Realm users Organization membership or Developer Console access.

Passkey relying-party configuration belongs to the Passkey built-in connector.
Sign-in & registration controls whether Passkey appears as a login method, while
MFA controls whether configured Passkeys can satisfy strong authentication.

Agents follow the same inventory-to-detail pattern as other first-class
identities. Agent details expose stable identity, delegated access, resource
connections, activity, and lifecycle governance without protocol internals.

Security policies, Sign-in & registration, and Hosted experience are explicit staged
forms. Each tab submits atomically from one footer; row controls never imply
immediate persistence. Independent resource actions remain individually
operable.

Both hosted configuration editors pair their staged form with a live page preview.
Sign-in & registration controls account creation and which configured sign-in
methods are visible. Hosted experience combines curated color schemes, a custom
five-token theme, essential brand assets, and legal destinations. Draft changes
appear immediately while remaining unapplied until the current tab is saved.

The preview follows the hosted journey itself: Create account, Forgot password,
Sign in, and Back to sign in navigate between pages without editor-only tabs.
