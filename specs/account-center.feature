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
    And the sidebar does not show placeholder Realm identity details

  @entrypoint:product-ui @journey:account-section-routes
  Scenario: Account Center groups related sections into route-backed pages
    When I open /, /profile, /security, /applications, /connections, /agents, or /organizations
    Then I see only the grouped account page in the account content area
    And every Account Center section is a root-level sibling route

  @entrypoint:product-ui @journey:account-admin-console-entry
  Scenario: Admin users can reach Console from Account Center
    Given my signed-in user has the admin role
    When I open /profile
    Then the account avatar menu includes a Console entry
    And the Account Center topbar does not repeat the Console entry

  @entrypoint:product-ui @journey:sign-out
  Scenario: Account Center signs out
    When I click Sign out
    Then I am redirected to hosted sign-in

  @entrypoint:product-ui @journey:profile-update
  Scenario: Profile edits are saved
    When I update my display profile
    Then Account Center shows the saved profile values

  @entrypoint:product-ui @journey:public-user-profile
  Scenario: A public User profile exposes an intentionally public representation
    Given a User has a username, public profile details, and linked accounts
    And the User explicitly chooses which linked accounts to publish with HTTPS profile URLs
    When a visitor opens the User profile
    Then Realmroot returns the User's public identity
    And a signed-in User can open their public profile from Profile settings or the shared avatar menu
    And a signed-in visitor sees the shared account avatar menu with an Account Center action in the public topbar
    And a signed-out visitor sees Sign in in the public topbar
    And the default summary omits Public Agents and recent activity
    And the full view includes Public Agents, sanitized recent activity, and only the chosen accounts that remain linked
    But the public profile never returns email, credentials, sessions, grants, or private activity details

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
    And a second TOTP enrollment is rejected while that factor remains enabled

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

  @entrypoint:product-ui @journey:provider-connections
  Scenario: External provider accounts have one unified connection
    Given a Provider Connector is available for sign-in and Agent access
    When I connect the provider account
    Then Realmroot redirects me through the Provider authorization or application installation flow
    And I return to Account Center Connections
    Then Account Center shows one Provider Connection for that provider
    And the connection shows its sign-in and Agent access capabilities
    And Sign-in & security links to the connection without offering a second management surface
    When I update authorization for that Provider Connection
    Then Realmroot reopens the Provider authorization flow without creating a second connection
    When I disconnect the Provider Connection
    Then its sign-in binding and external Resource authorizations are revoked together

  @entrypoint:product-ui @journey:provider-connection-sign-in-linking
  Scenario: An existing Provider Connection can add sign-in
    Given I connected a Provider account for Agent access without enabling sign-in
    And the Provider Connector is available for sign-in
    And the Provider account uses a different verified email from my Realmroot account
    When I link sign-in from the existing Provider Connection
    Then Realmroot redirects me through the Provider account-linking flow
    And the existing Provider Connection gains sign-in without creating a second connection

  @entrypoint:product-ui @journey:provider-identity-ownership
  Scenario: A Provider identity belongs to one Realmroot account
    Given my Provider identity is already connected to another Realmroot account
    When I authorize that same Provider identity from this account
    Then Realmroot rejects the connection with a Provider identity conflict
    And it does not reveal the other Realmroot account
    And it does not create another Provider Connection or Resource authorization

  @entrypoint:product-ui @journey:session-revocation
  Scenario: Sessions can be revoked
    Given my account has multiple sessions
    When I revoke all sessions or a single other session
    Then the revoked sessions can no longer be used

  @entrypoint:product-ui @journey:authorized-app-revoke
  Scenario: Authorized application access can be revoked
    Given I have granted an application access
    When I revoke it from the Account application-authorization collection
    Then the application is removed from authorized apps

  @entrypoint:product-ui @journey:authorized-app-separation
  Scenario: Authorized applications remain separate from Provider Connections
    Given I connected an external Provider account for Agent access
    And I granted an application access to my Realmroot identity
    When I open /applications
    Then the Account application-authorization collection shows only applications authorized to access my Realmroot identity
    And it includes active access established by user consent or platform policy
    When I open /connections
    Then I see the external Provider account and its Resource authorization summary

  @e2e @entrypoint:product-ui @journey:account-organization-management
  Scenario: Organization members manage their shared context
    When I create an Organization from Account Center
    Then I become its Owner
    And I can open its route-backed Organization Workspace with members, Roles, Applications, Resource Servers, Agents, Webhooks, activity, and settings
    And the Organization Workspace identifies its product layout as Developer Center rather than Account Center
    And the Workspace presents an Organization switcher and section navigation beside its content on wide screens
    And the same navigation is available from an accessible drawer on narrow screens
    And nested resource detail routes retain the Workspace navigation while reusing the canonical resource detail surface
    And Role details use the same object header, route-backed navigation tabs, and responsive content rhythm as other Workspace resources
    And its Agent identities, my Better Auth membership Roles, and active Agent Permissions come from canonical resource collections
    And the Organization collection opens a Workspace without a separate Current badge or Switch action
    And the Workspace URL is the current Organization while the authenticated session is synchronized for protocol context
    When I update its profile or invite a member with one or more Roles
    Then the Organization detail reflects the change

  @entrypoint:product-ui @journey:consumer-organization-boundary
  Scenario: A consumer Organization does not imply Developer Console access
    Given Organization creation is allowed but Developer Console remains restricted to Realm operators
    When I create and manage an Organization from Account Center
    Then I can manage its authorized Organization resources without an Open Console action
    And its membership grants no Realm platform administration

  @entrypoint:product-ui @journey:agent-approval
  Scenario: Delegated Agents receive identity separately from Resource authority
    Given an Agent requests delegated identity through AgentAuth device authorization
    When I approve the Agent identity enrollment
    Then the Agent receives a delegated identity without Resource API authority
    And account access requires a separately approved OAuth Resource scope

  @entrypoint:product-ui @journey:account-agent-management
  Scenario: Delegated agent access can be managed from Account Center
    Given I have active delegated agents and capability grants
    When I open Account Center
    Then I can inspect each stable Agent, its granted access, and its activity
    And protocol registrations, hosts, and identity bindings remain internal
    When I delete an Agent or revoke a selected Permission
    Then that delegated access is no longer active for my account
