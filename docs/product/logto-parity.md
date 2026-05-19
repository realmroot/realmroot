# Logto Parity Product Spec

## Reference Baseline

FlareAuth follows the Logto product model instead of a demo-page model:

- Hosted auth is a centralized OIDC interaction. Client apps redirect to the identity provider, users complete the hosted sign-in experience, and the provider redirects back with an authorization code.
- Account Center is a prebuilt account management surface for profile, security, MFA/passkeys, linked social accounts, sessions, and authorized apps.
- Console manages tenant resources: Applications/OIDC clients, Connectors, Users, Sign-in experience and Branding, Security, Organizations, Roles, API resources, and Deployment configuration.
- Onboarding is a system-readiness gate. It is not a normal Console resource and must not appear as a persistent sidebar item.

Reference docs:

- Logto sign-up and sign-in: https://docs.logto.io/end-user-flows/sign-up-and-sign-in
- Logto authentication parameters: https://docs.logto.io/end-user-flows/authentication-parameters
- Logto account settings and Account Center: https://docs.logto.io/end-user-flows/account-settings
- Logto Account Center UI integration: https://docs.logto.io/end-user-flows/account-settings/by-account-center-ui

## Information Architecture

Public and hosted auth:

| Route | Purpose |
| --- | --- |
| `/` | Public product entry. Blocked by first-admin onboarding when no admin exists. |
| `/sign-in` | Hosted sign-in experience. Blocked by first-admin onboarding when no admin exists. |
| `/sign-up` | Hosted sign-up experience. Blocked by first-admin onboarding when no admin exists. |
| `/forgot-password` | Hosted account recovery. Blocked by first-admin onboarding when no admin exists. |
| `/email-verification` | Hosted email verification. Blocked by first-admin onboarding when no admin exists. |
| `/oauth/consent` | Hosted consent interaction. Blocked by first-admin onboarding when no admin exists. |
| `/oidc/start` and `/oidc/callback` | Demo OIDC client journey for review and development. |
| `/onboarding` | First-admin bootstrap only. Reachable only while no admin exists. |

Account Center:

| Route | Purpose |
| --- | --- |
| `/account` | Redirects to `/account/profile`. |
| `/account/profile` | Profile, username, avatar, email, and password management. |
| `/account/security` | MFA, TOTP, passkeys, and security policy state. |
| `/account/linked-accounts` | Linked social accounts. |
| `/account/sessions` | Active sessions and device revocation. |
| `/account/authorized-apps` | Applications authorized by the current user. |

Console:

| Route | Purpose |
| --- | --- |
| `/admin` | Tenant health dashboard. |
| `/admin/onboarding` | Admin setup gate for required tenant configuration. Not shown in persistent navigation. |
| `/admin/applications` | OIDC clients and redirect URI configuration. |
| `/admin/users` | User management. |
| `/admin/connectors` | Social and OAuth connector configuration. |
| `/admin/sign-in` | Sign-in experience settings. |
| `/admin/security` | MFA, passkey, and session policy. |
| `/admin/organizations` | Organizations. |
| `/admin/roles` | Roles. |
| `/admin/api-resources` | API resources, audiences, and scopes. |
| `/admin/branding` | Hosted UI branding. |
| `/admin/deployment` | Cloudflare and management API deployment configuration. |

## Onboarding Gate State Machine

First-admin readiness is public and read from `/api/configz` through `onboarding.required`.

Admin setup readiness is protected and read from `/api/management/readiness`:

```json
{
  "admin": {
    "setupRequired": true,
    "setupHref": "/admin/onboarding",
    "missing": ["oidc_application"]
  }
}
```

States:

| State | Condition | Route behavior |
| --- | --- | --- |
| Fresh deployment | No admin user exists. | Every non-`/onboarding` product route redirects to `/onboarding`. |
| First admin locked, setup incomplete | Admin exists, but no OIDC application exists. | `/onboarding` redirects to `/admin/onboarding`; protected `/admin/*` routes redirect to `/admin/onboarding` after admin auth. |
| Setup complete | Admin exists and at least one OIDC application exists. | `/onboarding` and `/admin/onboarding` redirect to `/admin`; product routes are not trapped. |

## Acceptance Evidence

Reviewer acceptance path:

1. Fresh/no-admin state: visit `/`, `/sign-in`, `/sign-up`, `/account`, `/account/security`, `/admin`, and `/admin/applications`; each route should reach `/onboarding`.
2. Create the first admin at `/onboarding`; the form locks and routes the user toward sign-in for `/admin/onboarding`.
3. With an admin session and no OIDC application, visit `/admin/applications`; it should redirect to `/admin/onboarding`, and the sidebar must not contain Onboarding.
4. Create the first OIDC client from `/admin/onboarding`.
5. With setup complete, visit `/onboarding` and `/admin/onboarding`; both should land on `/admin`.
6. Visit `/account`; it should redirect to `/account/profile`.
7. Visit `/account/profile`, `/account/security`, `/account/linked-accounts`, `/account/sessions`, and `/account/authorized-apps` directly; reload and browser back/forward should preserve the selected section through the URL.
8. Visit each Console route in the route map directly and by sidebar navigation; every persistent nav item should point to a real route-backed page.

Automated evidence:

- Unit and route tests cover first-admin gate redirects, admin setup gate redirects, stale onboarding redirects, account root redirect, account deep links, and AdminShell nav without Onboarding.
- Playwright product journeys cover the first-admin gate, Account Center deep links, admin setup gate, and normal post-setup Console navigation.
