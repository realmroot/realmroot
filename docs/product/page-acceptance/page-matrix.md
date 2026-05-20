# Page Matrix

Each page ID is a task contract. A task that touches a page must list the page
IDs in its description and must meet all acceptance notes for those IDs.

## Hosted And Account

| Page ID | Route | Acceptance |
| --- | --- | --- |
| public-root | `/` | Signed-out users redirect to `/sign-in`; signed-in users redirect to `/profile`; no marketing or placeholder home page remains. |
| hosted-sign-in | `/sign-in` | Compact centered auth card; title, subtitle, identifier methods, password/magic link/OTP/passkey visibility, social providers, legal links, and footer alignment all reflect config. Social buttons must render from connector data and be usable. |
| hosted-sign-up | `/sign-up` | Same visual rhythm as sign-in; registration disabled state redirects or explains via real product copy; username/profile fields follow configured collection rules; footer is centered. |
| hosted-recovery | `/forgot-password` | Recovery uses configured email method, compact auth layout, correct validation, success state, and return link. |
| hosted-email-verification | `/email-verification` | Compact auth layout, resend flow, success/error states, and no dead controls. |
| hosted-callback-error | `/auth/callback` | Error page is compact, actionable, and links back to sign-in. |
| oauth-consent | `/oauth/consent` | App identity, requested scopes, approve/deny actions, signed-out redirect, and callback behavior are complete. |
| profile | `/profile` | Single top-level profile page with aligned identity, avatar, name, username, email, password, MFA, passkeys, linked accounts, authorized apps, sessions, and sign-out sections. All visible controls work. |
| account-compat | `/account/*` | Compatibility redirects to `/profile` or the equivalent profile section without exposing a second product route. |

## Console Shell

| Page ID | Route | Acceptance |
| --- | --- | --- |
| console-shell | `/console/*` | Desktop has fixed 248px left rail, grouped navigation, compact active states, no desktop topbar, and content starts near x=256 on a 1440px viewport. Mobile uses a usable drawer/topbar without overlap. |
| console-dashboard | `/console/dashboard` | Three equal metric cards, large activity panel, lower active-user cards, compact page header, no narrow centered dashboard. |
| console-onboarding-gate | `/onboarding`, `/console/onboarding` | Onboarding appears only when required; protected pages cannot be accessed until prerequisites are complete; no normal console menu item for onboarding. |

## Applications And Clients

| Page ID | Route | Acceptance |
| --- | --- | --- |
| applications-list | `/console/applications` | Compact toolbar, search/filter where present, primary create action, dense table/list, enabled row actions, and real empty state. |
| applications-create | create dialog from `/console/applications` | Guided client creation with type selection, redirect URI validation, generated client credentials, and reviewable success state. |
| application-detail-settings | `/console/applications/:id` | Object header, route-backed tabs, OIDC integration panel, redirect URI/post sign-out/CORS editors, metadata editor, enable/disable/delete flows, and no disabled textarea placeholders. |
| application-detail-branding | `/console/applications/:id/branding` | Per-application branding settings, preview when applicable, upload/URL handling, and save/discard flows. |

## Users

| Page ID | Route | Acceptance |
| --- | --- | --- |
| users-list | `/console/users` | Compact user inventory with search, pagination, create/import action where supported, status badges, and row navigation. |
| user-detail-profile | `/console/users/:id` | User header, aligned profile fields, editable profile data, ban/unban/reset flows, and route-backed tabs. |
| user-detail-security | `/console/users/:id/security` | MFA/passkey/session controls are live, destructive actions confirm, and no placeholder disabled state remains. |
| user-detail-sessions | `/console/users/:id/sessions` | Sessions list, revoke-one and revoke-all actions, empty state, and errors are tested. |
| user-detail-linked-accounts | `/console/users/:id/linked-accounts` | Linked provider list and unlink flow are usable. |
| user-detail-applications | `/console/users/:id/applications` | Authorized apps and consent revocation are usable. |
| user-detail-operations | `/console/users/:id/operations` | High-risk account operations are usable, confirmed, and audited through available operational data. |

## Sign-In Experience

| Page ID | Route | Acceptance |
| --- | --- | --- |
| sign-in-settings | `/console/sign-in-experience/sign-up-and-sign-in` | Left settings and right hosted-auth preview; registration, password, passkey, social, identifier-first, recovery, copy, and redirect settings are editable or hidden if out of v1 scope. |
| branding-settings | `/console/sign-in-experience/branding` | Same left/right layout as sign-in settings; logo/favicon upload, color, theme, custom CSS, and live preview all work. |
| collect-profile-settings | `/console/sign-in-experience/collect-user-profile` | Custom profile fields can be added, edited, reordered, required/optional, saved, and previewed in hosted sign-up. No disabled add-field placeholder. |
| account-center-settings | `/console/sign-in-experience/account-center` | Configures visible profile sections and field permissions; links to live profile; changes persist and are reflected in `/profile`. |
| content-settings | `/console/sign-in-experience/content` | Same left/right preview layout; language/copy/legal/support/password/account messages are editable or intentionally hidden; preview updates before save. |

## Connectors

| Page ID | Route | Acceptance |
| --- | --- | --- |
| connectors-passwordless | `/console/connectors/passwordless` | Cloudflare Email appears as built-in and inspectable, not disabled; SMS setup is a real configurable connector flow or hidden until supported. |
| connectors-social | `/console/connectors/social` | Provider-first add dialog, inferred provider defaults, only required secret fields, edit/test/delete flows, and visible hosted-auth social preview. |
| connector-detail | connector dialog/detail | Status, credentials binding, scopes, endpoints, issuer, test connection, save, disable, and delete are usable. |

## Security

| Page ID | Route | Acceptance |
| --- | --- | --- |
| mfa-settings | `/console/mfa` | Factor list and prompt policy are editable/persisted; passkeys/TOTP/email OTP are real controls; unsupported SMS is hidden unless configured. |
| security-password-policy | `/console/security/password-policy` | Password length, character types, compromised password checks, custom words, and rejection rules are editable and enforced by backend validation. |
| security-captcha | `/console/security/captcha` | Turnstile provider config, enable switch, site key/secret binding, flows, save/discard, and hosted-auth enforcement work. |
| security-blocklist | `/console/security/blocklist` | Subaddressing, email/domain list, validation, save/discard, and sign-up enforcement work. |
| security-general | `/console/security/general` | Session, MFA, passkey, and global security toggles reflect persisted policy and can be changed when shown. |

## Authorization

| Page ID | Route | Acceptance |
| --- | --- | --- |
| api-resources-list | `/console/api-resources` | Resource inventory, create action, search/filter, compact table, and empty state are live. |
| api-resource-detail-settings | `/console/api-resources/:id` | Resource header, identifier, metadata, enable/disable/delete, and route-backed tabs are complete. |
| api-resource-detail-scopes | `/console/api-resources/:id/scopes` | Scope CRUD, token claim toggles, validation, and assignment effects are tested. |
| api-resource-detail-permissions | `/console/api-resources/:id/permissions` | Permission CRUD and role assignment integration are usable. |
| roles-list | `/console/roles` | Role inventory, filters, create action, compact rows, and status states are usable. |
| role-detail-settings | `/console/roles/:id` | Role metadata, scope, token claim, enable/disable/delete, and save/discard are complete. |
| role-detail-permissions | `/console/roles/:id/permissions` | Permission assignment UI is live and persisted. |
| role-detail-assignments | `/console/roles/:id/assignments` | User/application/organization assignment UI is live and persisted. |
| organization-template-roles | `/console/organization-template/organization-roles` | Organization role templates are manageable without team-management surfaces. |
| organization-template-permissions | `/console/organization-template/organization-permissions` | Organization permission templates are manageable through API resources and role integration. |

## Organizations

| Page ID | Route | Acceptance |
| --- | --- | --- |
| organizations-list | `/console/organizations` | Organization inventory, create/search/filter, compact table, and status actions are live. |
| organization-detail-settings | `/console/organizations/:id` | Organization profile, logo upload, metadata, disabled state, and delete/update flows are live. |
| organization-detail-authorization | `/console/organizations/:id/authorization` | Organization role assignments and M2M application access are live where v1 supports organizations. |

## Customization, Webhooks, Logs, Settings

| Page ID | Route | Acceptance |
| --- | --- | --- |
| custom-jwt | `/console/customize-jwt` | Token customization controls are either real persisted controls or hidden; no arbitrary disabled claim editor. |
| webhooks-endpoints | `/console/webhooks/endpoints` | Endpoint CRUD, event selection, signing secret generation/rotation, search/filter, and delivery enablement are live. |
| webhooks-requests | `/console/webhooks/requests` | Delivery request list, filters, request detail, retry where supported, and empty states are live. |
| audit-logs | `/console/audit-logs` | If visible, search/filter/list/detail must be backed by real operational events. If enterprise audit is out of v1 scope, hide this page from navigation and route access. |
| tenant-settings-oidc | `/console/tenant-settings/oidc-configs` | Issuer/discovery/JWKS/session/signing-key settings are inspectable; key rotation is either implemented or hidden. |
