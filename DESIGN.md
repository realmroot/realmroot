---
version: 1.0
name: Realmroot Clear Aqua
description: A clear, white-first identity infrastructure interface with restrained aqua accents, explicit hierarchy, and dense but calm operational surfaces.

brand:
  descriptor: Identity and delegated access for people, apps, and agents.
  line: One realm. Every actor. Explicit authority.
  supportingLine: Your product's identity root.
  principles:
    - Explicit authority over decorative metaphor
    - White operational surfaces over tinted content areas
    - Aqua for identity, selection, focus, and primary action
    - Neutral structure with semantic colors reserved for status
    - Calm density suitable for security infrastructure

colors:
  primary: "#007B83"
  primaryHover: "#005F66"
  primarySoft: "#E7F6F6"
  signal: "#4FD1D0"
  ink: "#142022"
  muted: "#5B696B"
  border: "#DDE5E5"
  borderStrong: "#CBD6D6"
  canvas: "#FFFFFF"
  surfaceSoft: "#F6F9F9"
  navigation: "#F8FBFB"
  success: "#147A55"
  successSoft: "#EAF7F1"
  warning: "#8A6300"
  warningSoft: "#FFF7D9"
  danger: "#B83232"
  dangerSoft: "#FFF0F0"
  onPrimary: "#FFFFFF"

colorRules:
  - Primary content pages use white or near-white backgrounds.
  - Do not add a colored strip, border, or band to the page header.
  - Use primary aqua for active navigation, primary actions, links, focus, and small identity cues.
  - Use signal aqua only for non-text highlights and data visualization.
  - Do not use tinted cards as the default container treatment.
  - Semantic colors communicate state only; they are not alternate brand colors.

typography:
  family: Inter, "SF Pro Text", "Segoe UI", sans-serif
  monoFamily: ui-monospace, "SFMono-Regular", Consolas, monospace
  pageTitle: 30px / 1.15 / 670
  sectionTitle: 18px / 1.3 / 650
  cardTitle: 14px / 1.4 / 650
  body: 14px / 1.55 / 400
  label: 12px / 1.4 / 650
  caption: 11px / 1.45 / 400
  navigation: 13px / 1.4 / 620
  code: 12px / 1.55 / 400

spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
  8: 32px
  10: 40px
  12: 48px
  16: 64px

radius:
  control: 8px
  panel: 12px
  largePanel: 18px
  pill: 9999px

elevation:
  panel: 0 1px 3px rgb(20 32 34 / 6%)
  overlay: 0 24px 70px rgb(20 32 34 / 10%)
  drawer: -16px 0 40px rgb(20 32 34 / 12%)

layout:
  topbar:
    height: 64px
    background: "{colors.canvas}"
    borderBottom: "1px solid {colors.border}"
    rule: No colored top border or brand stripe.
  console:
    navigationWidth: 250px
    contentMaxWidth: 1160px
    contexts:
      - Define one shared navigation hierarchy: Dashboard; Identity; Develop; Authorization; Authentication; Configuration. Context changes visibility only and never renames a menu item, changes its icon, or moves it to another group.
      - Realm shows Dashboard; Identity with Users, Agents, and Organizations; Develop with Applications, Resource servers, and Webhooks; Authorization with Roles and Role assignments; Authentication with Identity providers, Sign-in and registration, and Security policies; Configuration with Experience and Settings.
      - Organization is available only when the Realm Developer policy makes that Organization's eligible members able to enter Console. It shows Dashboard; Identity with Users and Agents; Develop with Applications, Resource servers, and Webhooks; Authorization with Roles and Role assignments; Configuration with Settings.
      - Realm and Organization contexts reuse the same Users, Agents, Applications, Resource servers, and Roles pages, columns, and actions. Context never selects a separate data inventory.
      - Organization context preselects its Organization on Users and its Owner on Agents, Applications, and Resource servers. Roles are Realm-global and never receive an Owner filter; their Assignments default Context to the active Organization. These are ordinary visible filters that authorized users can change or clear.
    footer: Management API, Help and documentation
    detailPages:
      - Preserve the list-page breadcrumb and heading rhythm; do not stack a second object card below the page heading.
      - Integrate name, stable identifier, type or status, and description into one detail heading; omit decorative object marks when they add no recognition value.
      - Use Tabs only when an object has multiple distinct tasks; omit a single-item Tab bar.
      - Present read-only and operational fields as flat divided sections; reserve bordered containers for tables and bounded collections.
      - Keep object identity in the heading instead of repeating names and identifiers in the first content section.
      - Adapt Application details to client type. Web clients show OAuth, Authorizations, and lifecycle; do not expose workload or federated Credentials unless configured and applicable. Native and machine clients omit human sign-in tasks that do not apply.
      - Keep OAuth grants, redirects, PKCE, client authentication, and Token claims in one Tab. Audience belongs in Settings. Application consent uses the Realm-hosted experience and is not customizable per Application. Settings exposes a separate User consent policy: require approval by default, or explicitly skip routine approval for a trusted Application. Authorizations is the operational inverse of each User's Authorized apps list.
      - Application detail Tabs are read-only. Each editable Section exposes at most one Edit action in its header and opens one atomic drawer; only Rotate, Revoke, Disable, and Delete remain independent row actions with confirmation.
      - Preserve one three-column row grid for label, value, and action even when the action is empty. Never recalculate value alignment from the presence of a row action.
      - Use a single-column Overview for every first-class object; never restore the paired summary-section layout.
      - When a Tab contains only one section, omit the section heading and description and render its rows, toolbar, or table directly; retain headings only to distinguish two or more sections.
      - In flat row groups, the first row has no top border and the last row has no added bottom border; use one divider only between adjacent rows.
      - In every object list, place its stable product identifier directly below the name: Organization ID, Client ID, Role key, Provider ID, or Agent DID. Never use that line for type, ownership, issuer, or descriptive copy.
      - Put Owner and Created by near the right edge. Status comes before Owner; only Created, Updated, or Last activity may follow Owner. Without a time column, Owner is the final business column.
      - Give list-shaped tasks their own table-backed Tab: Agent Hosts and requests, User sessions and authorized apps, Application credentials, Organization members, and Role assignments.
      - Do not duplicate Applications or Resource servers inside Organization details. Browse them in the shared Develop lists with an Owner filter.
      - Treat Realm as the deployment, user pool, issuer, policy boundary, and trust root. It is not a company, team, or Organization.
      - Treat Organization as the generic shared identity and authorization context for a company, team, department, household, group, project, or individual.
      - Organization creation policy and the Realm Developer access policy are independent controls. Never infer one from the other.
      - Do not add a dedicated Developer Console column or relation table. Better Auth's existing Organization `metadata` stores the namespaced `realmroot.console.enabled` annotation. It is consulted only in selected-organizations mode; effective access also requires the Realm policy and an eligible member access level.
      - Do not add an Account Center visibility switch. Show Organizations when the user has a membership, a pending invitation, or permission to create one; hide it only when all three are absent.
      - An Organization may exist only for membership and shared authorization. Its members can manage technical resources only when the Realm Developer policy makes them eligible.
      - Agent is a first-class identity, never a technical resource. Every Agent belongs to either one User or one Organization. Realm lists show both owner type and owner; User and Organization details expose their respective Agent identities.
      - Agents are established only through Agent enrollment. Console never offers a New Agent action; it governs enrolled identities, Hosts, access requests, grants, and lifecycle.
      - Separate Organization Access Level from authorization Roles. Owner, Administrator, Developer, and Member govern Organization administration and never imply business API permissions.
      - Roles are reusable Realm-global permission definitions and never belong to an Organization. A Role may contain scopes from multiple Resource servers.
      - Role Assignments bind a Role to a User, Agent, or workload identity. A null Organization context is Realm-wide; an Organization context limits the assignment to requests acting in that Organization.
      - Keep a Realm-wide Role assignments list under Authorization with Subject, Role, Context, expiry, status, assignment actor, and update time. Organization context preselects its Context without changing the inventory or columns.
      - Keep OAuth consent with Applications, contextual authority with Role assignments, and delegated authority with each Agent's access grants. Do not merge them into one generic authorization object.
      - Permissions list scopes in one table with a Resource server column and resource-server filter. Assignments show Subject, Type, Context, expiry, and audit metadata; Activity records definition and assignment changes.
      - Keep Role metadata editing separate from permission maintenance. New Roles create metadata only; permissions are added later through the dedicated permission selector. The selector supports keyword search and Resource server filtering. Permissions come from Resource server scopes and are never free-form.
      - Keep ownership, access eligibility, and authority independent. A developer-enabled Organization may own an Application or Resource server; audience or access eligibility controls who may request access; Role assignments and Agent access grants control what an eligible actor may do.
      - Use Realm Organization pages for inventory, audit, and governance intervention. Day-to-day Organization management belongs in the Organization Console and Account Center.
      - Realm operators always receive complete identity and technical-resource inventories. Application and Resource server creation requires an explicit owner Organization and defaults to the private platform Organization created during bootstrap. Role creation has no Owner field.
      - Treat Agent Hosts as runtime credentials; never represent Native Resource servers as external account connections.
      - Keep edit forms in the heading action drawer and reserve Settings for access eligibility, recovery, and lifecycle operations.
      - Native Resource server details organize Overview, Resources, Roles & grants, and Settings around the authorization boundary; external Resource servers add Connections for delegated account authority.
      - Resource server Overview uses one content column for authorization and discovery readiness; Resources owns the OpenAPI resource and operation inventory, including the scopes required by each operation.
      - External Overview exposes its OIDC connector, target issuer, and token-exchange capabilities; Native Overview does not repeat realm-wide issuer or JWKS integration values.
      - Do not add a separate Permissions tab or Console-owned scope editor; scopes appear once beside the OpenAPI resources and operations that require them.
      - Keep resource metadata in the heading, Overview, and Edit resource flow; Settings contains only access eligibility and lifecycle actions rather than repeating read-only details.
      - Archive actions live in Settings and require confirmation because they revoke active authorization while preserving history.
  hostedAuth:
    widths:
      - Focused steps and messages: 380–400px
      - Sign-in, sign-up, recovery, and first-admin onboarding: 880px
      - Consent and delegated authorization: 460px
      - First-admin onboarding: 880px
    layoutFamilies:
      - Sign-in, sign-up, and recovery use a split brand-context and compact task layout on desktop.
      - Verification, MFA, callback, and device approval use focused single-column cards.
      - OAuth consent and Agent authorization use wider single-column decision cards.
      - First-admin onboarding also uses the split layout with realm-setup context.
    contentRules:
      - Keep alternative sign-in methods in one vertical list; never split them into columns.
      - Keep OAuth scope lists dense and height-bounded so large requests scroll inside the permission region.
      - Use progressive steps for recovery and verification instead of exposing every possible field at once.
      - Keep actor, target, scope, account, and lifetime visible together on delegated authorization pages.
      - Structure decisions as request subject, key facts, permission or lifetime controls, then final actions.
      - Place Privacy, Terms, Support, and the Realmroot attribution in a page-level footer below the task card, never inside it.
  accountCenter:
    navigationWidth: 260px
    contentMaxWidth: 900px
    navigation: Overview, Profile, Sign-in and security, Applications, Agents, Organizations
    navigationGroups:
      - Your account: Overview, Profile, Sign-in and security
      - Access and authority: Applications, Agents, Organizations
    visualLanguage:
      - Use a near-white canvas and white object surfaces.
      - Use a soft aqua navigation state instead of the Console's solid active state.
      - Use 13–16px interface copy; never reuse the Console's compact table typography.
      - Use horizontal tabs for genuine sibling tasks within Profile, Sign-in and security, Applications, and Agents.
      - Keep Overview as a summary page and the Organization root as a collection page; use Tabs only after opening one Organization.
      - Keep each tab panel borderless and begin directly with aligned rows and dividers; do not repeat the tab label with explanatory copy.
      - Reserve cards for summary metrics or exceptional emphasis; settings and collections use whitespace and dividers.
      - Separate concrete Agents and organizations with object headings and rules, never nested cards.
      - List safe review actions first; place revoke, retire, leave, and close actions in a detail or confirmation flow.
      - Expose Organization creation according to the independent Realm policy: Realm administrators only, approved users, or any verified user. The creator becomes Owner.
      - Let members view memberships and assigned Roles; Owners and Administrators manage Organization profile and members here whether or not developer access is enabled.
      - Show Open Console only when the Realm Developer policy and the user's Organization access level both allow it. Organization ownership alone never reveals technical resource controls.
  responsive:
    compactNavigation: 1050px
    mobile: 760px

components:
  buttonPrimary:
    height: 40px
    background: "{colors.primary}"
    text: "{colors.onPrimary}"
    radius: "{radius.control}"
  buttonSecondary:
    height: 40px
    background: "{colors.canvas}"
    text: "{colors.ink}"
    border: "1px solid {colors.border}"
    radius: "{radius.control}"
  input:
    height: 40px
    background: "{colors.canvas}"
    border: "1px solid {colors.borderStrong}"
    radius: "{radius.control}"
  panel:
    background: "{colors.canvas}"
    border: "1px solid {colors.border}"
    radius: "{radius.panel}"
  activeNavigation:
    background: "{colors.primary}"
    text: "{colors.onPrimary}"
    radius: "{radius.control}"
  activeTab:
    background: transparent
    text: "{colors.primaryHover}"
    borderBottom: "2px solid {colors.primary}"
  focusRing:
    outline: 3px solid rgb(0 123 131 / 28%)
    offset: 2px

interactionRules:
  - Primary pages are for browsing, scanning, and operating existing content.
  - Creation, editing, and configuration forms open in a drawer, modal, or dedicated secondary page.
  - List rows open detail pages; detail tabs group settings by responsibility.
  - Destructive actions remain visually separate and use danger color only at the action boundary.
  - Empty, loading, error, and disabled states preserve the same page geometry.

referenceArtifact: design/product-layouts/index.html
---

# Realmroot Clear Aqua

This is the selected Realmroot product design system. The interactive reference
covers Console, Hosted Auth, and Account Center with the current product's real
navigation, settings, entity details, and authorization journeys.
