# Product Acceptance Spec

This document is the executable product map for FlareAuth 1.0. It defines the
route inventory, domain model, settings surface, product acceptance matrix, and
review evidence needed to ship a complete Cloudflare-native identity provider.

## Reference Baseline

FlareAuth follows a full identity-provider product model instead of a demo-page model:

- Hosted auth is a centralized OIDC interaction. Client apps redirect to the
  identity provider, users complete the hosted sign-in experience, and the
  provider redirects back with an authorization code.
- Account Center is a prebuilt account-management surface for profile,
  password, MFA/passkeys, linked social accounts, sessions, and authorized apps.
- Console manages tenant resources: Applications/OIDC clients, Connectors,
  Users, Sign-in experience and Branding, Security, Organizations, Roles, API
  resources, and Deployment configuration.
- Onboarding is a system-readiness gate. It is not a normal Console resource and
  must not appear as a persistent sidebar item.

## Scope

### Included In 1.0

- Public product entry with deployment status and setup routing.
- Hosted sign-in, sign-up, password recovery, email verification, magic-link,
  email OTP, password sign-in, social connector entry points, OIDC consent, and
  sign-out.
- OIDC provider integration through discovery, authorization code with PKCE,
  token, JWKS, userinfo, and end-session endpoints.
- Account Center profile, email, password, security/MFA, passkeys, linked
  accounts, sessions, and authorized apps.
- Admin Console for dashboard, applications, connectors, users, sign-in
  experience, branding, security, organizations, roles, API resources, deployment
  settings, and setup checklist.
- Management APIs for every Console resource above.
- First-admin onboarding and admin setup onboarding.
- Route-backed product navigation. Product pages must not be implemented as
  local tab-only state when a URL is part of this spec.

### Explicitly Deferred

Only these enterprise capabilities are excluded from FlareAuth 1.0:

- Enterprise SSO connectors, including SAML and enterprise OIDC SSO.
- Team self-service administration distinct from tenant Organizations.
- LDAP/Active Directory directory sync.
- Audit-log product surfaces and log-retention controls.

The spec does not defer generic Applications, Connectors, Account Center,
Organizations, RBAC, API resources, MFA, passkeys, OIDC, or deployment
acceptance.

## Production-Ready Definition

FlareAuth 1.0 is production ready only when all of these are true:

- No demo-only product pages are reachable from public, Account Center, or Admin
  Console navigation.
- No dead dummy domains, fake callback domains, or placeholder issuer metadata
  appear in production configuration. Localhost values may appear only in local
  development and review-environment instructions.
- Every product page in this route map is URL-addressable and reload-safe.
- Public, account, admin, and setup surfaces are gated correctly.
- Account Center and Admin Console use persistent navigation for route-backed
  pages.
- E2E coverage is 100% of declared journeys in
  `tests/e2e/journey-coverage.json`, with no waivers.
- Automated code coverage is at least 90% overall before a production release.
- Review and production validation include screenshots or trace artifacts for
  all required product journeys.

## Route Inventory

### Public And Hosted Auth

| Route | 1.0 requirement | Gate |
| --- | --- | --- |
| `/` | Public product entry with API platform status and setup-aware CTA. | Redirects to `/onboarding` while first admin is required. |
| `/sign-in` | Hosted sign-in page with enabled identifiers, password, magic link, email OTP, social connectors, and sign-up link. | Redirects to `/onboarding` while first admin is required. |
| `/sign-up` | Hosted sign-up page with enabled identifiers and password requirements. | Redirects to `/onboarding` while first admin is required. |
| `/forgot-password` | Hosted password recovery with email OTP request and reset completion. | Redirects to `/onboarding` while first admin is required. |
| `/email-verification` | Hosted email verification request and OTP completion. | Redirects to `/onboarding` while first admin is required. |
| `/oauth/consent` | Hosted consent screen for requested client, redirect URI, and scopes. | Requires authenticated user session after first-admin setup. |
| `/auth/callback` | Hosted auth callback adapter route. | Uses auth boundary behavior. |
| `/onboarding` | First-admin bootstrap only. | Reachable only while no admin exists. |

### OIDC And Protocol Endpoints

| Route | 1.0 requirement | Gate |
| --- | --- | --- |
| `/api/auth/.well-known/openid-configuration` | OIDC discovery metadata with production issuer and endpoint URLs for SDK-free product integration. | Public. |
| `/api/auth/oauth2/authorize` | Authorization endpoint for code flow with PKCE S256 and allowed redirect URI validation. | Public protocol endpoint. |
| `/api/auth/oauth2/token` | Token endpoint for authorization-code exchange, public PKCE clients, confidential client authentication, and refresh where supported. | Client/protocol validation. |
| `/api/auth/jwks` | JWKS endpoint for token verification. | Public. |
| `/api/auth/oauth2/userinfo` | UserInfo endpoint for OpenID profile claims. | Bearer token required. |
| `/api/auth/oauth2/logout` or `/api/auth/oauth2/end-session` | RP-initiated end-session endpoint. | Session/protocol validation. |
| `/oidc/start` | Review/demo OIDC client starter. | Development and review only; not product navigation. |
| `/oidc/callback` | Review/demo OIDC callback. | Development and review only; not product navigation. |

### Account Center

| Route | 1.0 requirement | Gate |
| --- | --- | --- |
| `/profile` | Profile, username, avatar, primary email, password, MFA, passkeys, linked social accounts, sessions, and authorized app management. | Signed-in user required. |
| `/profile/security` | Redirect to `/profile`. | Signed-in user required. |
| `/profile/linked-accounts` | Redirect to `/profile`. | Signed-in user required. |
| `/profile/sessions` | Redirect to `/profile`. | Signed-in user required. |
| `/profile/authorized-apps` | Redirect to `/profile`. | Signed-in user required. |
| `/account` and legacy `/account/*` paths | Redirect to `/profile`. | Signed-in user required. |

### Admin Console

| Route | 1.0 requirement | Gate |
| --- | --- | --- |
| `/admin` | Tenant health dashboard with recent resources and setup health. | Admin session required; redirects to `/admin/onboarding` when setup is incomplete. |
| `/admin/onboarding` | Setup checklist and first OIDC client creation. Not shown in persistent navigation. | Admin session required; redirects to `/admin` after setup is complete. |
| `/admin/applications` | Application list, create flow, status toggles, and OIDC metadata. | Admin session and setup gate. |
| `/admin/applications/:id` | Application detail for redirect URIs, post sign-out URIs, CORS origins, grants, scopes, PKCE, client auth method, secrets, and disable state. | Admin session and setup gate. |
| `/admin/users` | User list, search, create flow, status, password reset, and admin-role controls. | Admin session and setup gate. |
| `/admin/users/:id` | User detail for profile, identifiers, sessions, roles, organizations, linked accounts, MFA/passkeys, and administrative flags. | Admin session and setup gate. |
| `/admin/connectors` | Connector list, provider-template create flow, detail/edit dialog, enable/disable controls, readiness checks, and delete flow. | Admin session and setup gate. |
| `/admin/connectors/:id` | Connector detail for provider type, client ID, secret binding, scopes, endpoints, enabled state, readiness, and sign-in availability. | Admin session and setup gate. |
| `/admin/sign-in` | Sign-in experience settings, enabled methods, default app/redirect, and legal/support links. | Admin session and setup gate. |
| `/admin/branding` | Hosted UI product name, logo, favicon, colors, custom CSS, preview, and deployment-owned branding state. | Admin session and setup gate. |
| `/admin/security` | MFA mode, passkey relying-party config, allowed origins, session lifetime, fresh-age, cookie cache, and password policy readiness. | Admin session and setup gate. |
| `/admin/organizations` | Organization list and create flow. | Admin session and setup gate. |
| `/admin/organizations/:id` | Organization detail for metadata, members, M2M apps, role assignments, and require-MFA toggle. | Admin session and setup gate. |
| `/admin/roles` | Role list and create flow for global, organization, API-resource, and application roles. | Admin session and setup gate. |
| `/admin/roles/:id` | Role detail for key, name, scope, permissions, assignments, and system/custom status. | Admin session and setup gate. |
| `/admin/api-resources` | API resource list and create flow. | Admin session and setup gate. |
| `/admin/api-resources/:id` | API resource detail for identifier, audience, token lifetime, default API flag, scopes, and role assignments. | Admin session and setup gate. |
| `/admin/deployment` | Cloudflare bindings, issuer, management API, health checks, migration status, email, queue, R2, and environment metadata. | Admin session and setup gate. |

Detail routes may ship after the current list pages, but they are part of the
1.0 product contract and must be implemented before production readiness is
claimed.

## Domain Model

| Domain | Core records | Required relationships |
| --- | --- | --- |
| Tenant setup | readiness state, first-admin state, setup checklist | Setup readiness depends on admin existence and at least one OIDC application. |
| User | id, email, username, display name, avatar, role, banned state, email verification state | Users own sessions, MFA factors, passkeys, linked accounts, grants, roles, and organization memberships. |
| Application | id, slug, name, client ID, type, redirect URIs, post sign-out URIs, CORS origins, scopes, grants, PKCE requirement, auth method, disabled state | Applications request OIDC authorization, receive grants, can be assigned roles, and may be organization-associated for M2M use. |
| Connector | provider type, provider ID, display name, client ID, secret binding, scopes, endpoints, enabled state | Connectors appear in hosted sign-in and Account Center linking when enabled. |
| Sign-in experience | identifiers, methods, social connector order, default app, default redirect, legal/support links, copy | Hosted auth pages render from this config. |
| Branding | product name, logo, dark logo, favicon, primary color, dark primary color, background, custom CSS | Hosted auth and Account Center share branding. |
| Security policy | MFA mode, TOTP availability, passkeys, RP ID/name, WebAuthn origins, session lifetime, fresh age, cookie cache | Hosted auth and Account Center enforce policy. |
| Organization | slug, name, display name, description, logo, metadata, disabled state, require-MFA flag | Organizations own memberships and organization role assignments. |
| Role | key, name, description, scope, system/custom flag, permissions | Roles bind users or clients to permissions globally or within organizations/resources. |
| API resource | identifier, audience/resource indicator, token lifetime, default flag, scopes, enabled state | API resources provide OAuth resource indicators and scope surfaces. |
| Deployment | environment, issuer, Cloudflare Worker, D1, R2, queue, email sender, cron, management API, health status | Production validation must prove bindings point to production resources. |

## Settings Inventory

| Surface | Required settings |
| --- | --- |
| Applications | Name, slug, client ID, client type, description, homepage/icon, redirect URIs, post sign-out redirect URIs, CORS origins, grant types, scopes, PKCE, token endpoint auth method, secret metadata, first-party/trusted flags, disabled state. |
| Connectors | Provider type, provider ID, display name, enabled state, client ID, secret binding, scopes, authorization URL, token URL, userinfo URL, icon/logo. |
| Users | Search, identifiers, display name, avatar, role/admin state, banned state, email verification, password reset action, sessions, linked accounts, organizations, roles, MFA/passkeys. |
| Sign-in experience | Password, sign-up, social login, magic link, email OTP, username, identifier-first, default application, default redirect URI, terms URI, privacy URI, support email, hosted copy. |
| Branding | Product name, headline/description, logo URL, dark logo URL, favicon URL, primary color, dark primary color, background color, custom CSS, preview evidence. |
| Security | MFA mode, TOTP enrollment, passkeys enabled, RP ID, RP name, WebAuthn origins, session expiration, session update age, fresh age, cookie cache, password policy readiness. |
| Account Center | Profile edit permissions, email/password change, MFA field permission, passkey registration/management, linked account unlink, session list/revoke, authorized app list/revoke, sensitive-change verification. |
| Organizations | Slug, name, display name, description, logo, metadata, disabled state, require-MFA, members, M2M apps, role assignments. |
| Roles | Key, name, description, scope, permissions/scopes, assignments, system/custom state. |
| API resources | Identifier, audience/resource indicator, name, description, token expiration, default API flag, scopes, enabled state. |
| Deployment | Issuer, discovery URL, Worker, D1, R2, queue, email sender, cron, environment, migration status, `/api/health`, `/api/configz`, management API readiness. |

## Onboarding Gate State Machine

First-admin readiness is public and read from `/api/configz` through
`onboarding.required`.

Admin setup readiness is protected and read from `/api/management/readiness`:

```json
{
  "required": [
    {
      "id": "oidc_application",
      "label": "Create an OIDC application",
      "description": "Register the first client so product routes can complete authorization code flows.",
      "status": "action_needed",
      "href": "/admin/onboarding",
      "action": "Create client"
    },
    {
      "id": "sign_in_method",
      "label": "Enable a sign-in method",
      "description": "Keep at least one hosted sign-in method available for users.",
      "status": "complete",
      "href": "/admin/sign-in",
      "action": "Review methods"
    }
  ],
  "recommended": [
    {
      "id": "email_delivery",
      "label": "Confirm email delivery",
      "description": "Email binding and sender settings are needed for verification, OTP, magic link, and reset flows.",
      "status": "action_needed",
      "href": "/admin/deployment",
      "action": "Review deployment"
    }
  ],
  "admin": {
    "setupRequired": true,
    "setupHref": "/admin/onboarding",
    "missing": ["oidc_application"]
  }
}
```

| State | Condition | Route behavior |
| --- | --- | --- |
| Fresh deployment | No admin user exists. | Every non-`/onboarding` product route redirects to `/onboarding`. |
| First admin locked, setup incomplete | Admin exists, but a required readiness item is incomplete. Required items are the first OIDC application and at least one enabled sign-in method. | `/onboarding` redirects to `/admin/onboarding`; protected `/admin/*` routes redirect to `/admin/onboarding` after admin auth. |
| Recommendations incomplete | Required items are complete, but email delivery, branding, security baseline, or connector status still needs review. | Admin routes are not blocked. `/admin/onboarding` redirects to `/admin`, and the dashboard/setup checklist can still surface recommendations. |
| Setup complete | All required items are complete. | `/onboarding` and `/admin/onboarding` redirect to `/admin`; product routes are not trapped. |

## Page Acceptance Matrix

| Surface | Acceptance |
| --- | --- |
| Public home | Shows API platform status, links to hosted auth/setup routes, and never exposes admin-only data. |
| Hosted sign-in | Renders only enabled methods, posts to Better Auth-native routes, preserves `return_to`, and supports password, magic link, email OTP, and social connector entry points. |
| Hosted sign-up | Creates an account through enabled identifiers and redirects into the authenticated product journey. |
| Recovery and verification | Request and completion steps are separate, user-visible, reload-safe, and backed by configured email flows. |
| OAuth consent | Shows client name, redirect URI context, requested scopes, approve/deny actions, and records consent against the application. |
| OIDC integration | Discovery, authorize, token, JWKS, userinfo, and end-session endpoints use production issuer metadata and validate redirect URI/client constraints. Product apps integrate with standard OIDC authorization code plus PKCE and do not call FlareAuth management or account APIs. |
| Account Center profile | Loads from account APIs, saves display name/username/avatar, requests email changes, changes password, and keeps `/profile` reload-safe. |
| Account Center security | Shows MFA policy, supports TOTP enrollment, passkey registration, and 2-step state where enabled. |
| Account Center linked accounts | Lists social identities and unlinks a connected account without leaving the section route. |
| Account Center sessions | Lists active sessions and supports single-session and all-session revocation. |
| Account Center authorized apps | Lists consented applications and supports grant revocation. |
| Admin dashboard | Shows tenant health, resource counts, recent applications, readiness, and security/sign-in summary. |
| Applications list/detail | Lists applications, creates clients, toggles disabled state, and detail page exposes redirect URI, post sign-out URI, CORS, grant, scope, PKCE, secret, and metadata controls. |
| Connectors list/detail | Lists connectors, creates OAuth/OIDC social providers from templates, edits and deletes connector records, toggles enabled state, and detail view exposes provider endpoints, scopes, client ID, secret binding reference, readiness, and sign-in availability without exposing secret values. |
| Users list/detail | Supports search, create user, password reset, admin-role toggle, and detail page exposes profile, identifiers, sessions, linked accounts, roles, organizations, MFA/passkeys, and ban/admin state. |
| Sign-in experience | Shows and persists enabled identifiers/methods, social login, default application/redirect, legal/support links, and hosted copy. |
| Branding | Shows brand preview and persists product name, logos, favicon, colors, background, and custom CSS. |
| Security | Shows and persists MFA mode, passkey/WebAuthn config, session policy, fresh-age, cookie cache, and password policy readiness. |
| Organizations | Lists and creates organizations; detail page manages metadata, members, M2M apps, role assignments, and require-MFA. |
| Roles | Lists and creates roles; detail page manages permissions/scopes and assignments by global, organization, API-resource, or application scope. |
| API resources | Lists and creates API resources; detail page manages audience/resource indicator, token lifetime, default API flag, scopes, and role assignments. |
| Deployment | Shows production Cloudflare bindings, issuer, health, migration state, email, queue, R2, cron, and management API readiness. |
| Setup checklist | Shows required and recommended readiness items with status, deep links, and actions; creates the first OIDC client; shows copyable OIDC integration details; disappears from persistent navigation after setup. |

## E2E Journey Coverage Contract

`tests/e2e/journey-coverage.json` is the executable declaration of browser
journeys. Each journey ID must have a matching assertion in
`tests/e2e/product-journeys.spec.ts`. The coverage test requires:

- Every declared journey has an assertion.
- Every assertion is declared.
- `target` remains `1`.
- `waivers` remains an empty array.
- The only Hono RPC smoke journey is `platform-status`.

As new detail routes from this spec ship, the same PR must add journey IDs and
Playwright assertions for those detail pages before claiming product acceptance.

## Review And Production Evidence

Every product PR that changes this spec, the journey map, or a product surface
must include the review-environment acceptance path:

1. Preview URL and commit SHA under review.
2. Setup state used for validation: fresh database, setup-incomplete tenant, or
   setup-complete tenant.
3. Screenshots or Playwright traces for first-admin gate, hosted sign-in,
   Account Center, Admin setup, Applications, Connectors, Users, Branding,
   Security, Organizations/RBAC/API resources, and Deployment.
4. OIDC discovery JSON captured from the preview or production domain.
5. `/api/health`, `/api/configz`, and `/api/management/readiness` evidence.
6. E2E command output showing 100% declared journey coverage.
7. Coverage command output showing at least 90% overall code coverage for
   production validation.
8. Confirmation that no demo-only pages, dead dummy domains, local tab-only
   product pages, or ungated protected surfaces remain.

## Reviewer Acceptance Path

1. Fresh/no-admin state: visit `/`, `/sign-in`, `/sign-up`, `/profile`,
   `/account`, `/admin`, and `/admin/applications`; each route should
   reach `/onboarding`.
2. Create the first admin at `/onboarding`; the form locks and routes the user
   toward sign-in for `/admin/onboarding`.
3. With an admin session and no OIDC application, visit `/admin/applications`;
   it should redirect to `/admin/onboarding`, and the sidebar must not contain
   Onboarding.
4. Create the first OIDC client from `/admin/onboarding`.
5. With setup complete, visit `/onboarding` and `/admin/onboarding`; both should
   land on `/admin`.
6. Visit `/profile`; it should render the account surface and remain on `/profile`.
7. Visit `/account`, `/account/profile`, `/account/security`,
   `/account/linked-accounts`, `/account/sessions`, and
   `/account/authorized-apps` directly; each route should redirect to
   `/profile`.
8. Visit `/admin/applications`; create or choose an application, open
   `/admin/applications/{id}`, edit redirect URIs, disable and re-enable the
   client, copy the standard OIDC integration details, and verify confidential
   client secret metadata/one-time rotation when using a confidential client.
   Verify a product app can complete authorization code with PKCE from discovery
   metadata without FlareAuth account, management, or custom SDK calls.
9. Visit every Console route in the route map directly and by sidebar
   navigation; every persistent nav item should point to a real route-backed
   page.
10. Capture evidence listed in the Review And Production Evidence section before
   requesting production approval.
