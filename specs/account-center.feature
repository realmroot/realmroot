Feature: Account Center
  As a signed-in user
  I want to manage my profile, credentials, sessions, and application grants
  So that I control my account state without Console access

  Background:
    Given a first admin exists
    And I am signed in

  @journey:account-center
  Scenario: Account Center loads account sections
    When I open /profile
    Then I see profile, security, sessions, connections, and applications

  @journey:account-deep-links
  Scenario: Legacy account deep links resolve to Account Center
    When I open a legacy account section route
    Then I land on the top-level Account Center page

  @journey:sign-out
  Scenario: Account Center signs out
    When I click Sign out
    Then I am redirected to hosted sign-in

  @journey:profile-update
  Scenario: Profile edits are saved
    When I update my display profile
    Then Account Center shows the saved profile values

  @journey:profile-avatar-upload
  Scenario: Avatar upload stores a profile image
    When I upload an avatar image
    Then the avatar preview updates
    And the account API persists the asset reference

  @journey:email-update
  Scenario: Email change requests verification
    When I request a new email address
    Then FlareAuth records an email change verification

  @journey:password-update
  Scenario: Password change rotates credentials
    When I submit my current password and a valid new password
    Then the new password can be used for sign-in

  @journey:password-policy-native-change
  Scenario: Native password change endpoint enforces managed password policy
    Given a tenant password policy is configured
    When I call the native password change endpoint
    Then weak new passwords are rejected
    And compliant passwords are accepted

  @journey:totp-flow
  Scenario: TOTP enrollment verifies a real code
    When I start TOTP enrollment
    And I submit the current authenticator code
    Then TOTP is enrolled for my account

  @journey:mfa-policy-enforcement
  Scenario: MFA policy controls enrollment and API access
    Given tenant MFA policy disables or requires TOTP
    When I attempt enrollment or protected API access
    Then FlareAuth enforces the current policy

  @journey:passkey-flow
  Scenario: Passkey enrollment completes with WebAuthn
    When I register a passkey from Account Center
    Then WebAuthn completes and the credential appears in security settings

  @journey:passkey-sign-in
  Scenario: Hosted passkey sign-in authenticates an enrolled passkey
    Given I have an enrolled passkey
    When I choose passkey sign-in from hosted auth
    Then I am authenticated through WebAuthn

  @journey:web3-wallet-sign-in
  Scenario: Web3 wallet sign-in follows the SIWE boundary
    Given my account has a wallet address binding
    When I start hosted wallet sign-in
    Then FlareAuth requires the external wallet signature boundary
    And the bound account can sign in

  @journey:linked-account-unlink
  Scenario: Social accounts can be linked and unlinked
    Given an OAuth connector is available
    When I connect and then unlink the provider account
    Then the connection list reflects the change

  @journey:session-revocation
  Scenario: Sessions can be revoked
    Given my account has multiple sessions
    When I revoke all sessions or a single other session
    Then the revoked sessions can no longer be used

  @journey:authorized-app-revoke
  Scenario: Authorized application access can be revoked
    Given I have granted an application access
    When I revoke the grant
    Then the application is removed from authorized apps

  Scenario: Delegated agents can request read-only account access
    Given an agent requests delegated access through AgentAuth device authorization
    When I approve account profile, session list, and authorized app list capabilities
    Then the agent receives a delegated identity scoped to those read-only account capabilities
    And account mutations remain unavailable through AgentAuth capabilities
