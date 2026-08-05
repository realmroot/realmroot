# Frontend reimplementation tracker

This document tracks the production implementation against the approved
Realmroot product-layout prototype in `design/product-layouts` and the semantic
rules in `DESIGN.md`. A row is complete only when the real route, loading,
empty, error, populated, mutation, responsive, and keyboard states have been
reviewed.

## Shared product rules

- Use the Radix Nova shadcn/ui base and semantic Realmroot tokens.
- Keep installed shadcn/ui source files close to upstream. Product styling and
  composition belong in product components and `src/styles.css`.
- Primary pages browse and operate existing content. Create and edit forms live
  in a Dialog, Sheet, or dedicated secondary route. Destructive actions use an
  AlertDialog.
- Capability-owned tables use one inventory model where Realm inventory and
  Organization inventory share the same representation. Route composition
  supplies an explicit owner boundary; browser context state never defines
  data ownership.
- Detail headings contain identity once. Tabs divide distinct tasks; flat
  divided sections replace card grids. A one-section tab omits the repeated
  section heading.
- Forms use the control that matches the value domain: Select or Combobox for
  enumerations and references, Switch for immediate booleans, Checkbox for form
  choices, RadioGroup or ToggleGroup for a short exclusive choice, InputOTP for
  codes, and text fields only for free-form values.
- Every surface includes loading, empty, error, success feedback, focus-visible,
  keyboard, narrow viewport, and destructive confirmation states.

## Console

| Area | Route or route family | Data status before rebuild | Target |
| --- | --- | --- | --- |
| Dashboard | `/console` | Real | Realm health, activity, and attention queue |
| Users | `/console/users` | Real | Searchable inventory with Organization filter |
| User detail | `/console/users/:id/*` | Real | Overview, Authentication, Sessions, Agents, Authorized apps, Settings |
| Agents | `/console/agents` | Real | Stable Agent inventory; no create action |
| Agent detail | `/console/agents/:id/*` | Partial | Overview, Requests & grants, Hosts, Activity, Settings |
| Organizations | `/console/organizations` | Real | Shared membership and authorization-context inventory |
| Organization detail | `/console/organizations/:id/*` | Partial | Platform inventory drill-down redirects to the canonical Organization Workspace |
| Applications | `/console/applications` | Real, old classification | Unified owner-filtered inventory |
| Application detail | `/console/applications/:id/*` | Real, old tabs | Overview, OAuth, Authorizations, Settings, including consent policy |
| Resource servers | `/console/api-resources` | Real, old product name | Unified native/external inventory with authorization second and owner last |
| Native resource detail | `/console/api-resources/:id/*` | Partial | Overview, Resources, Authority, Settings |
| External resource detail | `/console/api-resources/:id/*` | Partial | Overview, Resources, Authority, Settings |
| Webhooks | `/console/webhooks/*` | Real | Endpoints and Requests tabs |
| Organization Roles | legacy Console routes | Implemented | Removed from Console; managed in the canonical Organization Workspace |
| Identity providers | `/console/connectors` | Real | Built-in connectors, Social login, OIDC connectors |
| Sign-in & registration | `/console/sign-in-experience/*` | Real, old split | Methods, Profile collection, Legal & support with navigable preview |
| Security policies | `/console/security/*` | Real, old split | Authentication protection, Human verification, Other restrictions |
| Experience | canonicalized from branding/content routes | Real, old split | Brand assets, Color scheme, Legal & support with live preview |
| Realm settings | `/console/tenant-settings/*` | Partial | Realm access, Developer access, Deployment |
| Organization settings | Organization Workspace route | Missing | Organization profile and lifecycle only |

## Account Center

| Page | Route target | Data status before rebuild | Target |
| --- | --- | --- | --- |
| Overview | `/profile` or canonical sibling | Missing | Profile/security/access summary without tabs |
| Profile | canonical sibling route | Real | Avatar, display name, username, email |
| Sign-in & security | `/security` | Real | Password, MFA, passkeys, sessions, linked identities |
| Applications | canonical sibling route | Real but grouped elsewhere | Authorized apps and revocation |
| Agents | canonical sibling route | Partial | Personal Agent inventory, grants, and retirement |
| Organizations | canonical sibling route | Missing | Memberships, invitations, and conditional creation |
| Organization detail | `/organizations/:organizationId/*` | Partial | Canonical Organization Workspace with Overview, Members, Roles, Agents, Applications, Resource Servers, Webhooks, Activity, and Settings |

## Hosted Auth

| Journey | Route | Data status before rebuild | Target layout |
| --- | --- | --- | --- |
| Sign in | `/auth/sign-in` | Real | Split layout; one-column action stack |
| Sign up | `/auth/sign-up` | Real | Split layout |
| Recovery | `/auth/forgot-password` | Real | Split layout |
| Verification | `/auth/email-verification` | Real | Compact decision card |
| MFA | `/auth/continue` and hosted continuation | Real | Compact challenge card |
| OAuth consent | `/oauth/consent` | Real | Narrow decision card with scalable scope details |
| Device approval | `/device/*` | Real | Narrow decision card |
| Agent login | `/agent/approve` | Real | Narrow decision card |
| Agent enrollment | `/agent/enrollments/approve` | Real | Narrow decision card |
| Resource access | `/agent/resource-access/approve` | Real | Narrow decision card with exact scopes and lifetime controls |
| Callback/result | callback routes | Real | Compact status/result card |
| First admin | `/onboarding` and `/console/onboarding` | Real | Focused setup journey |

## Backend closure

- GitHub issue #126 implements independent Organization creation and Developer
  Console policies, platform Organization, ownership, audience/eligibility,
  Organization-scoped Better Auth Roles for humans, direct workload scopes, and Account Center
  Organization management.
- Application consent policy persists through the existing `trusted` API field
  while presenting it as an explicit user-consent policy.
- Frontend mutations use typed API contracts; new behavior is documented in the
  relevant behaviour-first scenario before implementation.

## Verification gates

1. `pnpm run spec:check`
2. `pnpm run typecheck`
3. Focused web/unit/integration tests during each slice
4. `pnpm run lint`
5. `pnpm test`
6. `pnpm run build`
7. `pnpm run e2e`
8. Playwright CLI matrix covering every route, interactive control, form input,
   validation state, confirmation, cancellation, success, error, responsive
   navigation, and keyboard path against the real stack
