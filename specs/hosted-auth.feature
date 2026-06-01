Feature: Hosted authentication
  As an end user
  I want hosted sign-in, sign-up, recovery, and consent journeys
  So that I can authenticate through the tenant's configured policies

  Background:
    Given a first admin exists
    And hosted auth reads runtime settings from /api/configz

  @entrypoint:product-ui @journey:public-sign-in
  Scenario: Hosted sign-in renders enabled methods
    When I open /auth/sign-in
    Then I see the hosted sign-in card
    And enabled tenant sign-in methods are visible

  @entrypoint:product-ui @journey:identifier-first-sign-in
  Scenario: Identifier-first sign-in carries the identifier into password auth
    Given identifier-first sign-in is enabled
    When I enter my email or username
    And I continue to password authentication
    Then the selected identifier is retained for credential submission

  @e2e @entrypoint:product-ui @journey:password-sign-in
  Scenario: Password sign-in submits credentials to the real auth endpoint
    Given password sign-in is enabled
    When I submit valid credentials on /auth/sign-in
    Then I am authenticated
    And I land in Account Center

  @entrypoint:product-ui @journey:passwordless-linkage
  Scenario: Passwordless mode removes password UI and blocks native password endpoints
    Given password sign-in is disabled by tenant policy
    When I open hosted sign-in
    Then password controls are not available
    And direct password auth endpoint calls are rejected

  @entrypoint:product-ui @journey:normal-signup-signin-account
  Scenario: Sign-up, sign-in, and Account Center complete as one real journey
    Given public sign-up is enabled
    When I create a user from hosted sign-up
    And I sign in as that user
    Then Account Center loads for the created account

  @entrypoint:product-ui @journey:sign-up
  Scenario: Hosted sign-up creates an account
    Given public sign-up is enabled
    When I submit name, email, username, and password on /auth/sign-up
    Then the account is created through the real auth endpoint
    And the page shows next-step confirmation

  @entrypoint:product-ui @journey:sign-up-disabled
  Scenario: Disabled sign-up blocks UI and direct API registration
    Given public sign-up is disabled
    When I open hosted sign-up
    Then registration is unavailable
    And direct sign-up endpoint calls are rejected

  @entrypoint:product-ui @journey:email-otp-sign-in
  Scenario: Email OTP sign-in completes code flow
    Given email code sign-in is enabled
    When I request an email code
    And I submit the latest verification code
    Then I am authenticated

  @entrypoint:product-ui @journey:email-otp
  Scenario: Email OTP connector settings control native email code endpoints
    Given managed Email code settings are changed in Console
    When I request or verify an email OTP
    Then the native auth endpoints follow the managed connector policy

  @entrypoint:product-ui @journey:password-recovery
  Scenario: Password recovery requests and completes OTP reset
    Given a user exists with password sign-in
    When I request password recovery
    And I submit the latest reset code with a new password
    Then the password is changed

  @entrypoint:product-ui @journey:email-verification
  Scenario: Email verification requests and completes verification
    Given a user has an unverified email
    When I request verification
    And I submit the latest verification code
    Then the email is marked verified

  @entrypoint:product-ui @journey:hosted-auth-error-flow
  Scenario: Hosted auth errors show recovery UI
    When hosted callback or session state contains an error
    Then a compact recovery screen is shown
    And the raw error context is surfaced to the user

  @entrypoint:product-ui @journey:oidc-hosted-sign-in-context
  Scenario: Hosted sign-in shows OIDC application context
    Given an OIDC client starts authorization
    When I arrive at hosted sign-in
    Then the application context is visible

  @entrypoint:product-ui @journey:oauth-consent
  Scenario: OAuth consent approves requested scopes
    Given a third-party OIDC application requests scopes
    When I approve consent
    Then FlareAuth redirects to the client callback with an authorization result

  @entrypoint:product-ui @journey:oauth-consent-account-switch
  Scenario: OAuth consent can switch accounts without losing the request
    Given a third-party OIDC application requests scopes
    When I switch accounts from the consent page
    Then FlareAuth returns to the same consent request after sign-in

  @entrypoint:product-ui @journey:oauth-consent-deny
  Scenario: OAuth consent denial returns safely to the client callback
    Given a third-party OIDC application requests scopes
    When I deny consent
    Then FlareAuth redirects to the client callback with a denial result

  @entrypoint:product-ui @journey:better-auth-device-approval
  Scenario: Device approval requires a signed-in browser session
    Given a public native application requests a Better Auth device approval code
    When I open the device verification link while signed out
    Then hosted sign-in preserves the device verification return path
    And approving or denying the device code requires the signed-in browser session

  @entrypoint:product-ui @journey:oidc-client-callback
  Scenario: OIDC client callback lands on the local callback page
    Given an OIDC callback response is produced
    When the browser follows the callback URL
    Then the local callback route renders the result
