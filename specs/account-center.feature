Feature: Account Center
  As a signed-in user
  I want to manage my profile, credentials, sessions, and application grants
  So that I control my account state without Console access

  Background:
    Given a first admin exists
    And I am signed in

  @e2e @entrypoint:product-ui @journey:account-center
  Scenario: Account Center loads account navigation
    When I open /profile
    Then I see the account navigation and the single Profile settings card

  @entrypoint:product-ui @journey:account-section-routes
  Scenario: Account Center groups related sections into route-backed pages
    When I open /profile, /security, or /connections
    Then I see only the grouped account page in the account content area
    And I can navigate between Profile, Security, and Connections as sibling routes

  @entrypoint:product-ui @journey:account-admin-console-entry
  Scenario: Admin users can reach Console from Account Center
    Given my signed-in user has the admin role
    When I open /profile
    Then the account avatar menu includes a Console entry

  @entrypoint:product-ui @journey:sign-out
  Scenario: Account Center signs out
    When I click Sign out
    Then I am redirected to hosted sign-in

  @entrypoint:product-ui @journey:profile-update
  Scenario: Profile edits are saved
    When I update my display profile
    Then Account Center shows the saved profile values

  @entrypoint:product-ui @journey:profile-avatar-upload
  Scenario: Avatar upload stores a profile image
    When I upload an avatar image
    Then the avatar preview updates
    And the account API persists the asset reference

  @entrypoint:product-ui @journey:account-preferences
  Scenario: Account presentation preferences apply to this browser
    When I change the Account Center language or time zone
    Then the interface language and displayed dates use that preference
    And the preference remains after reload

  @entrypoint:product-ui @journey:account-data-export
  Scenario: Account data can be exported
    When I request my account data export
    Then Realmroot downloads a machine-readable snapshot of my profile, identities, sessions, and grants

  @entrypoint:product-ui @journey:email-update
  Scenario: Email change requests verification
    When I request a new email address
    Then Realmroot records an email change verification

  @entrypoint:product-ui @journey:password-update
  Scenario: Password change rotates credentials
    When I submit my current password and a valid new password
    Then the new password can be used for sign-in
    And my current browser receives a replacement session while other sessions are revoked
    And a mismatched new-password confirmation is rejected before submission

  @entrypoint:product-ui @journey:password-policy-native-change
  Scenario: Native password change endpoint enforces managed password policy
    Given a tenant password policy is configured
    When I call the native password change endpoint
    Then weak new passwords are rejected
    And compliant passwords are accepted

  @entrypoint:product-ui @journey:totp-flow
  Scenario: TOTP enrollment verifies a real code
    When I start TOTP enrollment
    Then Account Center shows a scannable authenticator QR code
    When I submit the current authenticator code
    Then TOTP is enrolled for my account
    And backup codes are shown before I finish setup

  @entrypoint:product-ui @journey:mfa-policy-enforcement
  Scenario: MFA policy controls enrollment and API access
    Given tenant MFA policy disables or requires TOTP
    When I attempt enrollment or protected API access
    Then Realmroot keeps the profile, configuration, and enrollment surfaces available
    And redirects an unenrolled signed-in user to Account Security before protected product journeys
    And blocks every other protected API until enrollment is complete

  @entrypoint:product-ui @journey:passkey-flow
  Scenario: Passkey enrollment completes with WebAuthn
    When I register a passkey from Account Center
    Then WebAuthn completes and the credential appears in security settings

  @entrypoint:product-ui @journey:passkey-sign-in
  Scenario: Hosted passkey sign-in authenticates an enrolled passkey
    Given I have an enrolled passkey
    When I choose passkey sign-in from hosted auth
    Then I am authenticated through WebAuthn

  @entrypoint:product-ui @journey:web3-wallet-sign-in
  Scenario: Web3 wallet sign-in follows the SIWE boundary
    Given my account has a wallet address binding
    When I start hosted wallet sign-in
    Then Realmroot requires the external wallet signature boundary
    And the bound account can sign in

  @entrypoint:product-ui @journey:linked-account-unlink
  Scenario: Social accounts can be linked and unlinked
    Given an OAuth connector is available
    When I connect and then unlink the provider account
    Then the connection list reflects the change

  @entrypoint:product-ui @journey:session-revocation
  Scenario: Sessions can be revoked
    Given my account has multiple sessions
    When I revoke all sessions or a single other session
    Then the revoked sessions can no longer be used

  @entrypoint:product-ui @journey:authorized-app-revoke
  Scenario: Authorized application access can be revoked
    Given I have granted an application access
    When I revoke the grant
    Then the application is removed from authorized apps

  @entrypoint:product-ui @journey:resource-account-connections
  Scenario: Connected API resource accounts appear with authorized applications
    Given I connected an external API resource account for Agent access
    When I open /account/applications
    Then I see the API resource and connected external account
    And I can disconnect it separately from OAuth application grants

  @entrypoint:product-ui @journey:account-organization-management
  Scenario: Organization members manage their shared context
    When I create an Organization from Account Center
    Then I become its Owner
    And I can open the Organization detail with its members and pending invitations
    And its Agent identities, my contextual Role assignments, and active Agent access grants come from canonical resource collections shared with Console
    And I can switch the active Organization without changing Developer Console eligibility
    When I update its profile or invite a member with an access level
    Then the Organization detail reflects the change

  @entrypoint:product-ui @journey:consumer-organization-boundary
  Scenario: A consumer Organization does not imply Developer Console access
    Given Organization creation is allowed but Developer Console remains restricted to Realm operators
    When I create and manage an Organization from Account Center
    Then I can manage its profile and members without an Open Console action
    And its membership grants no access to technical resource management APIs

  @entrypoint:product-ui @journey:agent-approval
  Scenario: Delegated agents can request read-only account access
    Given an agent requests delegated access through AgentAuth device authorization
    When I approve account profile, session list, and authorized app list capabilities
    Then the agent receives a delegated identity scoped to those read-only account capabilities
    And account mutations remain unavailable through AgentAuth capabilities

  @entrypoint:product-ui @journey:account-agent-management
  Scenario: Delegated agent access can be managed from Account Center
    Given I have active delegated agents and capability grants
    When I open Account Center
    Then I can inspect each stable Agent and its granted access
    And protocol registrations, hosts, and identity bindings remain internal
    When I retire an Agent or revoke a selected access grant
    Then that delegated access is no longer active for my account
