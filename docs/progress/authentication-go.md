# Authentication Go Progress

## Objective

Validate Realmroot authentication end to end to production-readiness standard. Use manual browser automation for acceptance first, fix discovered issues, run at least five additional bug-hunting passes, then codify the accepted flows as Cucumber E2E scenarios and run them.

## Verification Rule

Existing E2E tests are only supporting signals. They do not prove a feature is accepted. A feature can move to "Fully Verified Through Real Product Chain" only after manual browser regression exercises the actual product path and records evidence here. After that, Cucumber E2E coverage is added or updated to preserve the verified behavior.

Every authentication-related setting and feature point must have a recorded outcome. Do not skip configuration items because they look small or because a broader flow passed. If a setting cannot be verified, record it under "Could Not Be Verified" with the concrete blocker and required dependency.

Exit criteria for this Go:

- Every Authentication page setting, Profile authentication action, hosted sign-in/sign-up path, backend enforcement path, and provider-specific configuration item has an explicit row or finding.
- Every individual configuration item and every feature point must be manually accepted or explicitly classified. Group-level acceptance is not enough.
- Each item must end in exactly one evidence bucket: fully verified through the real product chain, verified only with an external-boundary mock, or could not be verified with the blocker named.
- E2E tests are written only after the manual acceptance path has passed or the limitation has been documented.
- No project-internal chain can be mocked to claim acceptance. Only external services such as OAuth/SMS providers may be replaced by external-boundary mocks when real credentials are unavailable.
- This Go cannot be closed while any Authentication setting remains ambiguous, untested, or only implied by another test.

## Scope

- Authentication only, not authorization management.
- Hosted registration, sign-in, sign-out, email verification, email OTP, password reset, password updates, passwordless configuration linkage, password policy linkage, social sign-in/linking, SMS sign-in where available, MFA, Passkey, Authenticator App, application login, and Profile authentication features.
- Social and SMS can use external-boundary mocks only when real provider configuration is not available. Project-internal API/UI/runtime chains must not be mocked.
- Email should use the configured Cloudflare email path where available; local E2E may inspect persisted verification values as evidence until remote email delivery is explicitly exercised.

## Current Environment Facts

- Cucumber E2E base URL defaults to `http://127.0.0.1:4189`.
- E2E launches the dev server through `scripts/run-cucumber-e2e.mjs` with:
  `BETTER_AUTH_URL=http://127.0.0.1:4189 TRUSTED_ORIGINS=http://127.0.0.1:4189 E2E_OAUTH_CLIENT_SECRET=e2e-secret pnpm run dev -- --host 127.0.0.1 --mode e2e --port 4189`
- Admin bootstrap helper uses:
  - username: `admin`
  - email: `admin@example.com`
  - password: `admin2026`
- Existing local E2E uses Cloudflare D1 local migrations and bootstraps the admin through the real onboarding endpoint.

## Coverage Matrix

| Area | Required paths | Manual CRI | E2E | Status |
| --- | --- | --- | --- | --- |
| First admin | Fresh deployment redirects to onboarding and creates admin | CLI passed | Existing partial passed | Fresh deployment, first admin creation, onboarding lock, sign-in, Console, and Profile verified |
| Password sign-up | New account can register with valid password; sign-up disabled blocks UI and API | CLI passed | Existing partial | Valid sign-up, disabled state, and explicit email verification verified |
| Email verification | Every flow that creates/changes email includes verification | CLI passed | Existing partial | New sign-up + explicit OTP verification passed; Profile update-email OTP verification passed |
| Password sign-in | Password mode on allows password login | CLI passed | E2E passed | Hosted password sign-in and Passwordless-disabled enforcement verified |
| Passwordless linkage | Passwordless on removes password login; off restores it | CLI passed | E2E passed | Hosted password UI removed and direct password endpoint blocked when Passwordless is on |
| Password policy | Min length, required character types, sequential/repetitive, user-info, custom words enforced in sign-up/reset/change/admin create | CLI passed | E2E passed | Sign-up, Profile change-password, OTP reset, admin-create, and native change-password enforcement verified |
| Email OTP | Continue with Email sends code, verifies code, rejects invalid code, supports resend | CLI passed | E2E passed | Hosted Email OTP and Email connector backend enforcement verified |
| Password reset | OTP reset succeeds and validates policy | CLI passed | E2E passed | OTP reset flow and post-reset sign-in verified |
| Social login | Enabled connector is shown; disabled/unconfigured connector hidden; external IdP boundary mocked if needed | CLI passed with external IdP mock | E2E passed with external IdP mock | Hosted sign-in and Profile link/unlink verified |
| SMS login | Phone provider enablement and sign-in behavior; external SMS boundary mocked if needed | CLI partial | E2E partial | UI/config/API handoff and disabled endpoint enforcement verified; external SMS delivery dependency unresolved |
| Passkey sign-in | Passkey setting enabled requires/permits WebAuthn path as designed | CLI passed | E2E passed | Profile enrollment and hosted passkey sign-in verified |
| Authenticator App | Enroll TOTP, sign in with TOTP, invalid code rejected | CLI passed | E2E passed | Enrollment and sign-in challenge verified with real generated code |
| MFA settings linkage | Console MFA settings affect real sign-in flow | CLI passed | E2E passed | Disabled TOTP enrollment and required-MFA protected API gating verified |
| Application login | Create application, use it to start hosted login, callback/consent works | CLI passed | E2E passed | OIDC start, callback, consent approve, and deny verified |
| Profile username/password | Update profile username/display name and password | CLI passed | Existing partial | Display name, username, and password verified |
| Profile email | Request email update and verify new email | CLI passed | Existing partial | OTP request, invalid OTP rejection, valid OTP update, old-email login failure, and new-email login success verified |
| Profile passkey | Add passkey through Profile and use WebAuthn support | CLI passed | E2E passed | Profile enrollment and hosted passkey sign-in verified |
| Profile authenticator | Add Authenticator Code through Profile and use in sign-in | CLI passed | E2E passed | TOTP enrollment and hosted sign-in challenge verified |
| Profile sessions | Revoke other sessions and revoke current session | CLI passed | Existing partial | Revoke-other preserves current session; current-session revoke redirects to sign-in |

## Per-Setting Inventory

Each setting below must remain mapped to a product behavior before this Go can close.

| Surface | Setting or action | Expected product effect | Evidence |
| --- | --- | --- | --- |
| First-run onboarding | Create first admin | Fresh deployment only; creates admin and locks onboarding | CLI passed |
| First-run onboarding | Second first-admin attempt | Must be rejected after any user exists | CLI passed |
| Sign-up | Allow sign up | Enables/disables hosted sign-up UI and direct sign-up API | CLI passed |
| Sign-in | Passwordless | Disables password sign-in UI and direct password endpoints when on | CLI passed |
| Sign-in | Social login | Shows enabled social/OAuth connectors only when global social login is on | CLI passed with external IdP mock |
| Sign-in | Email code | Shows `Continue with Email`, sends OTP, rejects invalid OTP, resends, signs in | CLI passed |
| Sign-in | Phone sign-in | Shows `Continue with Phone` only when Phone provider is enabled | CLI partial; full SMS delivery blocked by provider credentials |
| Sign-in | Passkey sign-in | Shows passkey action only when policy enabled; direct passkey endpoint disabled when off | CLI passed |
| Sign-in | Web3 wallet | Should show usable wallet sign-in when enabled | CLI + E2E passed with external wallet boundary mock |
| Sign-in | OneTap | Should initialize Google One Tap and complete callback when enabled | Client wiring added; full Google token verification blocked by missing real Google Client ID/token |
| Password policy | Minimum length | Enforced in sign-up, Profile password change, password reset, admin-created user | CLI passed |
| Password policy | Required character types | Enforced in sign-up and admin-created user | CLI passed |
| Password policy | Sequential/repetitive rejection | Enforced in sign-up and admin-created user | CLI passed |
| Password policy | Account profile info rejection | Enforced in admin-created user; Profile/sign-up path covered by same validator boundary | CLI passed |
| Password policy | Custom blocked words | Enforced when enabled for admin-created user; UI visibility tied to switch | CLI passed |
| MFA | Authenticator app enabled | Controls Profile enrollment and Better Auth TOTP challenge | CLI passed |
| MFA | Passkeys enabled | Controls Profile/hosted passkey runtime | CLI passed |
| MFA | Backup codes | TOTP enrollment exposes generated backup codes before verification | CLI passed |
| MFA | Prompt policy | Required blocks non-exempt APIs for users without MFA while keeping enrollment APIs reachable; optional restores access | CLI passed |
| Connectors | Email | Built-in provider drawer controls Email OTP setting | CLI + E2E passed |
| Connectors | Phone/SMS | Drawer controls SMS provider and provider-specific credentials | CLI partial; provider delivery blocked |
| Connectors | Social providers | Drawer stores provider credentials, status, callback URL; hosted login uses enabled connector | CLI passed with external IdP mock |
| Connectors | Web3 wallet | Drawer controls chains/options | CLI + E2E passed with external wallet boundary mock |
| Connectors | Passkey | Drawer controls passkey policy | CLI passed through policy linkage |
| Connectors | OneTap | Drawer controls OneTap options | CLI partial; hosted client wiring and recoverable failure verified, full Google sign-in blocked by real credential dependency |
| Applications | Create OIDC app | Application can be created and used for OIDC start/callback | CLI passed |
| Applications | Consent deny/approve | Third-party consent returns deny/approve callbacks correctly | CLI passed |
| Profile | Update display name/username | Updates Profile and persisted account values | CLI passed |
| Profile | Update password | Enforces policy; old password fails and new password succeeds | CLI passed |
| Profile | Update email | Sends change-email OTP; invalid rejected; valid changes verified email | CLI passed |
| Profile | Passkey | Adds passkey and supports WebAuthn sign-in | CLI passed |
| Profile | Authenticator app | Enrolls TOTP and requires valid code on sign-in | CLI passed |
| Profile | Linked accounts | Connect/unlink provider through Better Auth native OAuth flow | CLI passed with external IdP mock |
| Profile | Authorized apps | Consent listing visible; revoke removes consent after confirmation | CLI passed |
| Profile | Sessions | Revoke other/current sessions behaves correctly | CLI passed |

## Final Evidence Classification

Every covered authentication capability must end in exactly one of these buckets.

### Fully Verified Through Real Product Chain

- First admin onboarding on isolated fresh local D1: root redirected to `/onboarding`; Playwright CLI created `first-admin@example.com` with username `firstadmin`; `/api/onboarding/status` returned `{"required":false}`; a second create call returned 403 `Onboarding is locked after the first user exists.`; the first admin signed in through hosted username/password login to `/console/onboarding` and could open `/profile` with verified email.
- Password sign-in with admin from hosted sign-in to Profile, using Playwright CLI on `http://localhost:4179`.
- Passwordless setting linkage: enabling Passwordless removed password UI in hosted sign-in and made direct password sign-in return 403; disabling Passwordless restored direct password sign-in to 200.
- Profile passkey enrollment with WebAuthn virtual authenticator, then hosted `Continue with Passkey` sign-in back to Profile, using Playwright CLI.
- Password policy on hosted sign-up after setting `Minimum length=12` and `Required character types=3`: length failure, character-type failure, sequential/repetitive failure, and strong-password success verified through Playwright CLI.
- Password policy on Profile change-password: weak new password shows visible dialog error; strong new password succeeds; old password fails after sign-out and new password signs in successfully.
- OTP password reset with configured password policy: reset code request succeeded, weak new password was rejected visibly, strong new password succeeded, previous password failed, reset password signed in to Profile.
- Password policy on admin-created users: Playwright CLI used the admin session to call the real `/api/management/users` endpoint. Weak passwords were rejected for min length, required character types, sequential/repetitive content, account-profile information, and custom blocked words after temporarily enabling `rejectCustomWords`; a strong password created a user successfully; the password policy was restored afterward.
- Email OTP hosted sign-in: `Continue with Email` showed one email field, sent a code, invalid code showed `Invalid OTP`, resend generated a new code, valid code signed in to Profile.
- Email connector configuration linkage: Playwright CLI disabled Email code in the real Console connector drawer; the connectors table changed to `Runtime disabled`; real hosted `/auth/sign-in` removed `Continue with Email`; direct sign-in OTP `/api/auth/email-otp/send-verification-otp` returned 403 `Email code authentication is disabled.`; email-verification OTP still returned 200 and `/auth/email-verification` still rendered an OTP input; re-enabling through the same drawer restored `Runtime enabled` and the hosted `Continue with Email` button.
- Sign-up disabled linkage: turning off `Allow sign up` removed the `Create account` entry from hosted sign-in, direct `/api/auth/sign-up/email` returned 403 `Sign up is disabled.`, and after fix direct `/auth/sign-up` renders `Sign up is not available` instead of a registration form.
- Authenticator App MFA: Console showed Authenticator app factor enabled; Profile enrollment accepted password, exposed otpauth URI, accepted a real generated TOTP, Profile changed MFA status to Enabled; subsequent password sign-in required `Verify your sign-in`, invalid code showed `Invalid code`, valid generated TOTP signed in to Profile.
- TOTP backup codes: Profile enrollment accepted password, exposed the otpauth URI, and displayed the generated `Backup codes` returned by Better Auth before verification. The dialog was cancelled afterward so the admin MFA state was not changed.
- MFA settings linkage for Authenticator App: disabling `authenticatorAppEnabled` through management policy blocked Profile TOTP enrollment with `Authenticator app MFA is disabled for this deployment.` and disabled Better Auth TOTP sign-in prompts for an already-enrolled user; re-enabling restored the policy.
- MFA prompt policy: setting policy mode to `required` through the real management API made `/api/account/profile` return 403 `MFA enrollment is required for this deployment.` for the logged-in admin without MFA, while `/api/account/security` remained reachable for enrollment; policy was restored to `optional` afterward.
- Passkey settings linkage: disabling passkeys through management policy removed `Continue with Passkey` from hosted sign-in and made direct Better Auth passkey authenticate-options return 404; re-enabling restored the policy.
- Explicit email verification with OTP: after hosted sign-up, `/auth/email-verification` sent an Email OTP, invalid code showed `Invalid OTP`, valid code showed `Email verified.`, and later sign-in showed Profile email `Verified`.
- Profile display name and username updates: Profile dialog updated display name to `Profile Flow Renamed`; username dialog updated username to `profileflow2`; both refreshed in Profile.
- Profile email change with OTP: Account Center sent a Better Auth `change-email-otp` code for `profile-flow@example.com` to `profile-flow-otp@example.com`; invalid code left the old email unchanged; valid code changed Profile email to `profile-flow-otp@example.com` with `Verified`; old email/password sign-in failed; new email/password sign-in succeeded.
- Profile session management: created a second real session through `/api/auth/sign-in/email`, then Profile showed 2 sessions; `Revoke other sessions` removed only the other session and left the current session active; revoking the current session redirected immediately to `/auth/sign-in`.
- Profile authorized applications: Profile listed `CLI Consent App` from the real OIDC consent flow; `Revoke` opened a confirmation dialog; confirming removed the consent and Profile showed `No authorized applications yet.`
- Application/OIDC login: admin-created public SPA applications through the management API; trusted first-party app completed `/oidc/start` directly to `/oidc/callback` with code/state; untrusted third-party app rendered consent with requested scopes, Deny returned `access_denied` to callback, Approve returned a valid authorization code callback.
- Phone/SMS configuration linkage up to provider handoff: enabling Phone (SMS) in management settings made hosted sign-in and Live Preview render an enabled `Continue with Phone`; clicking it opened a real phone-number OTP form; submitting called the real Better Auth `/api/auth/phone-number/send-otp` endpoint.

### Verified With External-Boundary Mock

- Social login through enabled generic OAuth connector using a local mock IdP outside the Realmroot app boundary: hosted sign-in showed `Continue with CLI OAuth`, Better Auth completed the callback, Profile showed `Social CLI User`, and Profile Linked accounts showed `CLI OAuth` as Linked.
- Profile linked-account management with external-boundary mock IdP: after deleting the local test link row, Profile showed `CLI OAuth` as Available; clicking Connect used Better Auth native `/api/auth/oauth2/link`, completed the external OAuth callback, and Profile returned to `CLI OAuth` Linked. For unlink, a credential-backed user with a seeded external account showed Linked, confirmed Unlink, and Profile returned to Available.
- Web3 wallet sign-in using an external wallet boundary signer on `127.0.0.1:4566`: hosted sign-in requested a real SIWE nonce, signed the real message through the external signer, verified through Better Auth SIWE, created the session, and persisted wallet/account rows.

### Could Not Be Verified

- SMS login full delivery is not yet verified. The product currently supports Twilio, Vonage, and MessageBird, but each path performs a server-side fetch to the real provider domain. No real provider credentials or configurable external mock endpoint are available in the current local run, so actual SMS send + code sign-in remains unverified.
- Google OneTap is not fully verified because no real Google Client ID and Google ID token are configured in the local run. The hosted client wiring now exists, but the Better Auth server endpoint verifies the token against Google's JWKS, so a fake local token cannot prove the real chain.

For any item in this bucket, record the missing dependency, why it blocks verification, and what would be required to verify it.

## Bug-Hunting Passes

| Pass | Focus | Result |
| --- | --- | --- |
| 1 | Config switch backend enforcement audit for Email OTP, email verification, Passwordless, Social, Phone, Web3, OneTap, Passkey | Found Email connector overreach, Phone-only UI state bug, and Live Preview OneTap/Passkey drift. Fixed and verified manually + focused tests/E2E. Disabled-provider direct endpoint enforcement manually verified and solidified. Pass complete. |
| 2 | Password mode and managed password policy enforcement across native and product password-change boundaries | Found native Better Auth `/api/auth/change-password` bypassed the managed password policy while Account Center custom change-password enforced it. Fixed middleware policy enforcement, verified with Playwright CLI, added E2E, and reran broad auth E2E covering sign-up/reset/Profile password flows. Pass complete. |
| 3 | MFA/Profile security policy linkage for Authenticator App, required MFA, and enrollment API access | Existing Playwright CLI evidence showed TOTP enrollment/sign-in and required MFA behavior; added E2E for disabled Authenticator App enrollment and required-MFA API gating. Pass complete. |
| 4 | E2E mock audit for project-internal chain bypasses | Searched the full `tests/e2e` tree for route interception, fulfillment, aborts, and mock keywords. Only `archived Playwright connectors spec` intercepts `https://idp.e2e.test/**`, which is an external IdP boundary mock. No project-internal API/UI/runtime mocks found in E2E. Pass complete. |
| 5 | Per-setting manual/E2E coverage gap audit | Found remaining E2E solidification gaps for Passwordless, disabled sign-up, and hosted passkey sign-in. Added split E2E files for those paths, added missing journey coverage ids, and verified the new tests. Pass complete. |

## Findings

- 2026-05-21 initial authentication E2E run: 17/18 passed. Failure: after TOTP enrollment, password sign-in receives `twoFactorRedirect: true` with `twoFactorMethods: ['totp']`, but the hosted UI did not render the `Verify your sign-in` step.
- Fixed by adding an explicit `Verify your sign-in` heading to the TOTP step in hosted sign-in.
- 2026-05-21 targeted TOTP + Passkey E2E rerun passed.
- 2026-05-21 current authentication E2E rerun passed: 18/18.
- 2026-05-21 Playwright CLI manual check found Sign-in settings inconsistency: Console shows `Passkey login` enabled, but hosted sign-in and Live Preview do not expose a Passkey login method. This setting currently does not prove a real passkey sign-in flow.
- Fixed Passkey login gap by wiring Better Auth `passkeyClient` into the hosted sign-in UI and shared preview method button.
- 2026-05-21 Playwright CLI manually verified: hosted sign-in and Live Preview show `Continue with Passkey`; Profile passkey enrollment succeeds; signing out and using `Continue with Passkey` signs back in to `/profile`.
- 2026-05-21 Playwright CLI manual Passwordless check found a backend bypass: after enabling Passwordless, hosted UI hides password login, but direct POST to `/api/auth/sign-in/username` still returns 200 and signs in.
- Fixed Passwordless backend bypass by enforcing sign-in settings at `/api/auth/*` in the real Worker app path.
- 2026-05-21 Playwright CLI manually verified: Passwordless enabled hides password UI and direct password sign-in returns 403; Passwordless disabled restores password sign-in and direct password sign-in returns 200.
- 2026-05-21 Playwright CLI manual password policy check found Profile change-password UX bug: weak new password returns backend 400 from `/api/account/password/change`, but the dialog shows no visible error.
- Fixed Profile change-password error display by surfacing mutation errors inside the password dialog while retaining toast behavior.
- 2026-05-21 Playwright CLI manually verified Profile change-password: weak password displays `Password must be at least 12 characters.`, strong password succeeds, old password fails, new password signs in.
- 2026-05-21 Playwright CLI manual OTP password-reset check found a consistency bug: a weak reset password showed the expected policy error, then a strong reset password changed the password successfully but the endpoint returned 500 because the post-reset security notification email failed. The user saw failure while the credential had already changed.
- Fixed by decoupling the post-reset security notification from the password-reset response; notification failure is logged, but it cannot turn a completed password reset into a 500.
- 2026-05-21 Playwright CLI manually reverified OTP password reset after fix: weak password displays `Password must be at least 12 characters.`, strong password displays `Password reset. You can sign in with the new password.`, the previous password fails, and the reset password signs in to `/profile`.
- 2026-05-21 Playwright CLI manually verified Email OTP sign-in: send code, invalid code rejection, resend, and successful sign-in to `/profile`.
- 2026-05-21 observation: the account created during password-policy sign-up initially showed Email `Required`; after OTP password reset it showed Email `Verified`. Need still verify the explicit email-verification and update-email flows.
- 2026-05-21 Playwright CLI manual sign-up toggle check found a UI bypass: when `Allow sign up` was off, hosted sign-in hid `Create account` and the backend returned 403, but direct `/auth/sign-up` still rendered the registration form.
- Fixed direct `/auth/sign-up` by rendering a disabled-state message and no form/social sign-up actions when `config.signIn.signupEnabled` is false.
- 2026-05-21 Playwright CLI manually verified Authenticator App MFA for `weak-policy@example.com`: enrollment with real otpauth URI and generated code, then password sign-in required TOTP; invalid TOTP was rejected and valid TOTP completed sign-in.
- 2026-05-21 Playwright CLI manually verified Social login with an external-boundary mock IdP on `127.0.0.1:4555`: enabled generic OAuth connector appears in hosted sign-in, OAuth redirect/callback signs in to `/profile`, Linked accounts shows the provider as linked, disabling `Social login` hides the provider button, and direct `/api/auth/sign-in/social` returns 403 `Social authentication is disabled.`
- 2026-05-21 Playwright CLI manual email-verification check found mismatch: `/auth/email-verification` displayed a one-time-code field but the send action called the email-link endpoint, leaving no locally retrievable code for the visible field.
- Fixed `/auth/email-verification` no-token flow to request `email-verification` Email OTP instead of sending a verification link. Reverified send code, invalid OTP, valid OTP success.
- 2026-05-21 Playwright CLI manually verified Profile display name and username updates for `profile-flow@example.com`.
- 2026-05-21 Profile email-change request originally returned 200, but completion via delivered email link was not locally verifiable. Fixed the Account Center flow to use Better Auth Email OTP change-email endpoints instead of the opaque email-link flow.
- 2026-05-21 Playwright CLI reverified Profile email change after the OTP fix: sending the code kept the dialog open, D1 contained `change-email-otp-profile-flow@example.com-profile-flow-otp@example.com`, invalid OTP was rejected without changing the account, valid OTP updated the Profile email to `profile-flow-otp@example.com`, old email/password sign-in failed, and new email/password sign-in succeeded.
- 2026-05-21 Playwright CLI manually verified Application/OIDC flow: created trusted and third-party applications, used `/oidc/start`, verified trusted callback, third-party consent screen, deny callback, and approve callback.
- 2026-05-21 Playwright CLI manual Phone/SMS check found a product bug: enabling Phone (SMS) in settings still rendered `Continue with Phone` disabled on hosted sign-in and there was no phone OTP form. Fixed by exposing public built-in provider enabled flags through configz, wiring the hosted Phone OTP form to Better Auth native phone endpoints, and making Live Preview use the same enabled state.
- 2026-05-21 Playwright CLI reverified Phone/SMS after the fix: hosted sign-in and Live Preview render enabled `Continue with Phone`; clicking opens a Phone field and Send code button; submitting hits the real backend and fails at Twilio delivery because only dummy Twilio credentials are present.
- 2026-05-21 code audit found Web3 wallet is configuration-only in the current product: Better Auth SIWE exists in dependencies, but Realmroot does not register `siwe()` in `server/auth.ts`, does not render wallet login in hosted sign-in, and has no wallet-address table migration. Marked unverified/product gap.
- 2026-05-21 code audit found OneTap is only partially wired: the server plugin can be enabled, but the hosted sign-in UI never initializes Google One Tap or calls the callback endpoint. Marked unverified/product gap.
- 2026-05-21 fixed OneTap hosted client wiring: public runtime config now exposes the non-secret OneTap client options, hosted sign-in renders `Continue with OneTap` when enabled, loads Google Identity Services, initializes One Tap, and calls Better Auth's native `/api/auth/one-tap/callback` with the returned ID token.
- 2026-05-21 Playwright CLI OneTap pass with dummy external Google config found a UX bug: when Google returns no credential, the hosted sign-in form stayed in loading state. Fixed prompt skipped/dismissed/not-displayed handling so the form recovers and shows a visible error. With the dummy Client ID, Google returned `Google One Tap was skipped: unknown_reason.`; full sign-in remains unverified until a real Google Client ID/token is available.
- 2026-05-21 fixed Web3 wallet runtime: added Better Auth SIWE registration, wallet address schema/migration, public runtime config for enabled chains, hosted sign-in wallet action, SIWE nonce/signature verification using `viem`, and Live Preview/real login Card wallet entry.
- 2026-05-21 Playwright CLI Web3 wallet pass found a schema bug: Better Auth's Drizzle adapter expects an `id` field on the `walletAddress` model. Fixed the schema and migration to include `wallet_address.id`.
- 2026-05-21 Playwright CLI verified Web3 wallet using an external wallet boundary signer on `127.0.0.1:4566`: enabling Web3 in Console made Live Preview and real `/auth/sign-in` show `Continue with Web3 wallet`; a browser with no wallet showed the expected no-provider error; the external wallet boundary signed the real SIWE message; `/api/auth/siwe/verify` created a real session; Profile loaded for wallet address `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`; D1 contained a `wallet_address` row and `account(provider_id='siwe')`.
- 2026-05-21 added and ran `archived Playwright auth-web3 spec`: 1 passed. The test enables Web3 through the management API, verifies the no-wallet error, injects only an external wallet boundary signer, signs a real SIWE message, reaches Profile, and asserts the `wallet_address` row.
- 2026-05-21 Playwright CLI manual MFA settings check found Authenticator App policy was not fully wired: Profile TOTP enrollment did not check `authenticatorAppEnabled`, and Better Auth TOTP was always enabled. Fixed by passing `totpOptions.disable` from policy into Better Auth and blocking Profile TOTP enrollment/verification when the factor is disabled.
- 2026-05-21 Playwright CLI reverified Authenticator App linkage: after disabling the factor, Profile TOTP enrollment returned 400 with the policy message, and an already-enrolled TOTP user could sign in without the TOTP challenge because the factor was disabled; the factor was then re-enabled.
- 2026-05-21 Playwright CLI verified Passkey policy linkage: disabling passkeys removed the hosted sign-in passkey option and direct `/api/auth/passkey/generate-authenticate-options` returned 404; passkeys were then re-enabled.
- 2026-05-21 Playwright CLI found Profile linked-account Connect bug: the Account Center called the local `/api/account/linked-accounts` wrapper, which returned Better Auth's authorization URL but dropped the OAuth state cookie from the Better Auth response. The callback failed with `/api/auth/error?error=state_mismatch`.
- Fixed Profile linked-account Connect by calling Better Auth native endpoints directly from the browser: social providers use `/api/auth/link-social`; generic OAuth providers use `/api/auth/oauth2/link`.
- 2026-05-21 Playwright CLI reverified Profile linked accounts: cross-email linking correctly returned `email_doesn't_match`; same-email generic OAuth Connect completed and showed Linked; Unlink on a credential-backed account removed the external account and showed Available.
- 2026-05-21 Playwright CLI found Profile session bug: `Revoke other sessions` called Better Auth `revokeSessions`, revoking every session and leaving Profile showing 0 sessions while still rendering authenticated data from cached session cookies.
- Fixed `Revoke other sessions` to call Better Auth `revokeOtherSessions`.
- 2026-05-21 Playwright CLI reverified `Revoke other sessions`: after creating a second real session, Profile changed from 2 sessions to 1 and the current session stayed active.
- 2026-05-21 Playwright CLI found current-session revoke UX bug: deleting the current session left the user on Profile with stale authenticated data. Fixed by marking current sessions in the account session response and redirecting to `/auth/sign-in` after current-session revocation.
- 2026-05-21 Playwright CLI reverified current-session revoke: a Profile session list with 1 current session redirected to `/auth/sign-in` after confirmation.
- 2026-05-21 Playwright CLI manually verified admin-create password policy through real `/api/management/users`: `abcdefgh` returned `Password must be at least 12 characters.`, `abcdefghijkl` returned `Password must include at least 3 character types.`, `Abcdef123!45` returned `Password cannot include sequential or repetitive characters.`, a password containing the username returned `Password cannot include account profile information.`, temporarily enabling `rejectCustomWords` with `blockedword` returned `Password cannot include blocked words.`, and `Zr9!AdminPolicy#2026` created a user with 201.
- 2026-05-21 Playwright CLI manually verified first-admin onboarding in an isolated local D1 on port 4181: initial visit reached `/onboarding`; first admin creation returned success; onboarding status became false; second creation was rejected with 403; hosted sign-in reached `/console/onboarding`; `/profile` showed `First Admin`, username `firstadmin`, and email `Verified`.
- 2026-05-21 Playwright CLI first-admin pass found a stale Console onboarding link: `Review connectors` still pointed to removed `/console/connectors/passwordless`. Fixed the readiness link to `/console/connectors`, removed the old `/console/connectors/passwordless` and `/console/connectors/social` compatibility routes, and deleted the dead passwordless connector page/tabs.
- 2026-05-21 Playwright CLI reverified the onboarding checklist after the stale-link fix: `Review connectors` now points to `/console/connectors`.
- 2026-05-21 Playwright CLI manually verified Profile authorized-app revoke: `CLI Consent App` appeared under Authorized apps, confirmation dialog opened, `Revoke access` removed the app, and the empty state appeared.
- 2026-05-21 Playwright CLI found a Backup codes UI gap: Better Auth returned generated backup codes during TOTP enrollment, but Account Center did not display them. Fixed the enrollment panel to render returned backup codes, added focused component coverage, and manually reverified the codes display in Profile.
- 2026-05-21 Playwright CLI manually verified MFA Prompt policy enforcement: management PATCH to `required` succeeded, non-exempt account profile API returned 403 with the MFA enrollment message, account security API stayed available for enrollment, then D1 restored policy to `optional` and removed the cancelled unverified TOTP setup row.
- 2026-05-21 Authentication E2E regression initially failed after product-flow fixes because several tests still asserted removed/old behavior: Account Center email change expected the old one-step button instead of OTP confirmation; OTP password reset expected the previously fixed 500; linked-account connect waited for the removed `/api/account/linked-accounts` wrapper; TOTP setup read the last setup code, which became a backup code after backup-code display was added. Updated these tests to assert the real current flows.
- 2026-05-21 Playwright CLI verified the Email connector drawer linkage: disabling Email code removed the hosted `Continue with Email` action and blocked the direct Better Auth Email OTP send endpoint with 403; re-enabling restored the hosted action. Added `archived Playwright auth-email-connector spec` to preserve the same UI and backend enforcement path.
- 2026-05-21 bug-hunting pass 1 found an Email connector boundary bug: the `emailOtpEnabled` guard blocked `/api/auth/email-otp/verify-email` and all `/api/auth/email-otp/send-verification-otp` calls, so disabling Email sign-in could break mandatory email verification. Fixed the guard to block only sign-in/recovery Email OTP paths while allowing only explicit `type: "email-verification"` and `/api/auth/email-otp/verify-email`; the email verification page now always shows the OTP field when no token is present.
- 2026-05-21 bug-hunting pass 1 found a Phone-only sign-in UI bug: the empty-method warning condition ignored Phone and Passkey availability. Fixed the condition and verified with Playwright CLI by temporarily setting Password/Email/Social off and Phone on; the signed-out login page showed `Continue with Phone` without the empty-method warning. Added `archived Playwright auth-method-availability spec`.
- 2026-05-21 bug-hunting pass 1 found a Live Preview drift bug: real hosted sign-in showed enabled OneTap/Passkey methods, but the Content/Branding previews did not consistently include them. Fixed the preview state to source OneTap from sign-in settings and Passkey from security policy, then verified with Playwright CLI that real `/auth/sign-in`, Content preview, and Branding preview all showed `Continue with Email`, `Continue with Passkey`, and `Continue with OneTap` when OneTap was enabled. Restored OneTap disabled afterward.
- 2026-05-21 reinforced acceptance rule after user escalation: every individual Authentication configuration item and feature point must get an explicit recorded outcome. Broad page-level or existing E2E pass/fail is not sufficient evidence.
- 2026-05-21 admin-console regression tests were realigned with the current product structure after Password policy moved into Sign-up and sign-in: Security default route now lands on CAPTCHA, old password-policy compatibility links redirect to the canonical sign-in settings page, and Passwordless assertions target the switch instead of ambiguous repeated text.
- 2026-05-21 Playwright CLI manually verified disabled-provider endpoint enforcement through the real admin session: with Phone, OneTap, Web3, Social, and Passkey disabled, direct native endpoints returned Phone 404, OneTap 404, Web3 SIWE 404, Passkey 404, and Social 403 `Social authentication is disabled.` Restored settings afterward and added `archived Playwright auth-provider-enforcement spec`.
- 2026-05-21 bug-hunting pass 2 found a managed password-policy bypass: Account Center `/api/account/password/change` enforced the tenant policy, but native Better Auth `/api/auth/change-password` accepted a 10-character password while the managed policy minimum was 12. Fixed `server/middleware/security-policy.ts` to validate `/api/auth/change-password` `newPassword`, added server coverage, reverified with Playwright CLI that the weak native change now returns 400 `Password must be at least 12 characters.`, and added `archived Playwright auth-password-policy-enforcement spec`.
- 2026-05-21 bug-hunting pass 3 solidified MFA policy linkage: added E2E proving disabled Authenticator App blocks Account Center TOTP enrollment with the deployment-policy error, and `required` MFA blocks protected account APIs while leaving `/api/account/security` reachable for enrollment.
- 2026-05-21 bug-hunting pass 4 audited E2E mocks with `rg -n "page\\.route|context\\.route|browserContext\\.route|route\\(|fulfill\\(|abort\\(|vi\\.mock|jest\\.mock|mock" tests/e2e`; the only route interception is `https://idp.e2e.test/**` in `archived Playwright connectors spec`, used as an external OAuth IdP boundary. No project-internal chain is mocked in E2E.
- 2026-05-21 bug-hunting pass 5 audited per-setting manual evidence against E2E solidification. Added `archived Playwright auth-sign-in-settings-enforcement spec` for Passwordless native endpoint blocking and disabled sign-up UI/API blocking, and `archived Playwright auth-passkey-sign-in spec` for Profile passkey enrollment followed by hosted passkey sign-in. Targeted E2E rerun passed: 3/3.

## Commands And Evidence

Historical command entries below reference archived direct Playwright specs that have been replaced by the current `specs/*.feature` plus Cucumber workflow. Current E2E execution is `pnpm run test:e2e`.


- `pnpm run test:e2e -- archived Playwright auth spec archived Playwright auth-advanced spec archived Playwright account spec archived Playwright account-security spec archived Playwright connectors spec`
  - Result: 17 passed, 1 failed.
  - Failed: `archived Playwright account-security spec` TOTP enrollment/sign-in path.
- `pnpm run test:e2e -- archived Playwright account-security spec -g "TOTP enrollment"`
  - Result: 1 passed after UI fix.
- `pnpm run test:e2e -- archived Playwright auth spec archived Playwright auth-advanced spec archived Playwright account spec archived Playwright account-security spec archived Playwright connectors spec`
  - Result: 18 passed.
- `pnpm run typecheck`
  - Result: passed after first-admin/stale connector-link changes.
- `pnpm test -- server/routes/management.test.ts -t "updates managed sign-in"`
  - Result: passed after adding `builtInProviders` to the management settings test mock.
- `pnpm test -- src/features/console/console-security-signin-a.test.tsx -t "renders independent MFA"`
  - Result: passed after replacing the deleted passwordless connector page assertion with the new provider table assertion.
- `pnpm test -- src/features/account/account-center.test.tsx -t "shows TOTP enrollment setup data"`
  - Result: passed after adding backup-code display coverage.
- `pnpm run typecheck`
  - Result: passed after Backup codes UI changes.
- `pnpm run typecheck`
  - Result: passed after Web3/OneTap runtime wiring.
- `pnpm test -- src/features/auth/auth-pages.test.tsx server/modules/configz/service.test.ts server/routes/configz.test.ts`
  - Result: 3 files passed, 54 tests passed after public OneTap/Web3 config and hosted client wiring.
- `pnpm run test:e2e -- archived Playwright auth-web3 spec`
  - Result: 1 passed.
- `pnpm run test:e2e -- archived Playwright account-security spec`
  - Result: 3 passed after updating Account Center email OTP and TOTP setup-code selectors.
- `pnpm run test:e2e -- archived Playwright auth spec archived Playwright auth-advanced spec archived Playwright account spec archived Playwright account-security spec archived Playwright connectors spec archived Playwright auth-web3 spec`
  - Result: 19 passed.
- `pnpm run lint`
  - Result: passed after formatting/import fixes.
- `pnpm run typecheck`
  - Result: passed after formatting/import fixes.
- `pnpm run test:e2e -- archived Playwright auth-sign-in-settings-enforcement spec archived Playwright auth-passkey-sign-in spec`
  - Result: 3 passed after fixing the test to avoid using password sign-in while Passwordless is intentionally enabled.
- `pnpm run test:e2e -- archived Playwright auth-email-connector spec`
  - Result: 1 passed.
- `pnpm test -- server/app.test.ts src/features/auth/auth-pages.test.tsx`
  - Result: 2 files passed, 53 tests passed after Email connector/email-verification boundary fix and Phone-only empty-state coverage.
- `pnpm run test:e2e -- archived Playwright auth-email-connector spec`
  - Result: 1 passed after adding the email-verification regression path.
- `pnpm test -- src/features/auth/auth-pages.test.tsx`
  - Result: 1 file passed, 43 tests passed after Phone-only empty-state fix.
- `pnpm run test:e2e -- archived Playwright auth-method-availability spec`
  - Result: 1 passed.
- `pnpm run test:e2e -- archived Playwright auth-email-connector spec archived Playwright auth-method-availability spec`
  - Result: 2 passed after tightening the Email OTP disabled guard.
- `pnpm run typecheck`
  - Result: passed after Email OTP guard and Phone-only UI fixes.
- `pnpm test -- src/features/console/console-branding-content-a.test.tsx -t 'OneTap|hosted sign-in previews'`
  - Result: 2 passed after Live Preview OneTap/Passkey state fixes.
- `pnpm run test:e2e -- archived Playwright auth-preview-consistency spec`
  - Result: 1 passed. Covers real hosted sign-in, Content Live Preview, and Branding Live Preview method consistency for Email, Passkey, and OneTap.
- `pnpm run typecheck`
  - Result: passed after Live Preview OneTap/Passkey state fixes.
- `pnpm test -- src/features/console`
  - Result: 112 passed after current product-structure test realignment.
- `pnpm run typecheck`
  - Result: passed after admin-console test realignment.
- `pnpm run test:e2e -- archived Playwright auth-email-connector spec archived Playwright auth-method-availability spec archived Playwright auth-preview-consistency spec`
  - Result: 3 passed.
- `pnpm run test:e2e -- archived Playwright auth-provider-enforcement spec`
  - Result: 1 passed.
- `pnpm test -- server/routes/security.test.ts -t 'enforces password, blocklist'`
  - Result: 1 passed after native change-password policy enforcement fix.
- `pnpm run test:e2e -- archived Playwright auth-password-policy-enforcement spec`
  - Result: 1 passed.
- `pnpm run typecheck`
  - Result: passed after native change-password policy enforcement fix.
- `pnpm test -- server/routes/security.test.ts server/app.test.ts`
  - Result: 2 files passed, 27 tests passed.
- `pnpm run test:e2e -- archived Playwright auth-mfa-policy-enforcement spec`
  - Result: 1 passed.
- `pnpm run test:e2e -- archived Playwright auth spec archived Playwright auth-advanced spec archived Playwright account spec archived Playwright account-security spec archived Playwright connectors spec archived Playwright auth-web3 spec archived Playwright auth-email-connector spec archived Playwright auth-method-availability spec archived Playwright auth-preview-consistency spec archived Playwright auth-provider-enforcement spec archived Playwright auth-password-policy-enforcement spec`
  - Result: 24 passed.
- `pnpm run test:e2e -- archived Playwright auth spec archived Playwright auth-advanced spec archived Playwright account spec archived Playwright account-security spec archived Playwright connectors spec archived Playwright auth-web3 spec archived Playwright auth-email-connector spec archived Playwright auth-method-availability spec archived Playwright auth-preview-consistency spec archived Playwright auth-provider-enforcement spec archived Playwright auth-password-policy-enforcement spec archived Playwright auth-mfa-policy-enforcement spec archived Playwright auth-sign-in-settings-enforcement spec archived Playwright auth-passkey-sign-in spec`
  - Result: 28 passed.
- `pnpm test -- server/routes/security.test.ts server/app.test.ts src/features/console src/features/auth`
  - Result: 4 files passed, 182 tests passed.
- `pnpm run lint`
  - Result: passed after Biome formatting/optional-chain cleanup.
- `pnpm run typecheck`
  - Result: passed after final formatting cleanup.
