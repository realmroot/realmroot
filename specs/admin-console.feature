Feature: Admin Console
  As a tenant administrator
  I want Console pages to manage applications, users, connectors, security, and deployment settings
  So that Realmroot can be configured from the browser

  Background:
    Given a first admin exists
    And I am signed in to Console

  @entrypoint:product-ui @journey:admin-dashboard
  Scenario: Admin dashboard loads tenant health
    When I open /console
    Then the dashboard shows tenant health from real management APIs

  @entrypoint:product-ui @journey:admin-signed-out-redirect
  Scenario: Signed-out Console routes redirect before data loads
    Given I am signed out
    When I open a Console route
    Then I am redirected to admin sign-in
    And management API data requests are not made

  @entrypoint:product-ui @journey:admin-setup-gate
  Scenario: Console setup gate handles missing OIDC applications
    Given no OIDC application exists
    When I open Console
    Then setup guidance is shown without blocking persistent Console routes

  @entrypoint:product-ui @journey:admin-onboarding
  Scenario: Admin onboarding creates the first OIDC client
    Given no OIDC application exists
    When I complete Console onboarding
    Then the first OIDC client is created
    And integration details are visible

  @entrypoint:product-ui @journey:admin-route-backed-navigation
  Scenario: Console navigation exposes persistent route-backed pages
    When I use Console navigation
    Then each visible product page has a canonical route

  @entrypoint:product-ui @journey:admin-application-inventory
  Scenario: Applications page lists OIDC clients and status controls
    Given OIDC applications exist
    When I open the applications page
    Then clients and lifecycle controls are visible

  @entrypoint:product-ui @journey:admin-create-application
  Scenario: Applications page creates an OIDC client
    When I create an application from Console
    Then the new OIDC client appears in inventory
    And native clients can be created with device login enabled

  @entrypoint:product-ui @journey:admin-application-detail
  Scenario: Application detail manages lifecycle, redirects, integration details, and secret rotation
    Given an application exists
    When I open its detail page
    Then settings, branding, redirect URIs, integration details, and secret rotation are available

  @entrypoint:product-ui @journey:admin-create-user
  Scenario: Users page creates a user
    When I create a user from Console
    Then the user is persisted through the management API

  @entrypoint:product-ui @journey:admin-user-inventory
  Scenario: Users page supports search and status inventory
    Given users exist
    When I open the users page
    Then user search and status inventory are visible

  @entrypoint:product-ui @journey:admin-user-detail
  Scenario: User detail updates profile, resets password, and revokes sessions
    Given a user exists
    When I open user detail
    Then profile update, password reset, and session revocation controls work

  @entrypoint:product-ui @journey:admin-create-connector
  Scenario: Connectors page creates a draft social connector
    When I create a social connector from Console
    Then the connector is saved as a draft

  @entrypoint:product-ui @journey:admin-connector-inventory
  Scenario: Connectors page lists email and SMS setup state
    When I open connectors
    Then Email and SMS setup state is visible

  @entrypoint:product-ui @journey:admin-social-connector-inventory
  Scenario: Social connectors list provider settings and availability
    When I open social connector settings
    Then provider settings and availability are visible

  @entrypoint:product-ui @journey:admin-oidc-connector-inventory
  Scenario: Connectors page manages multiple standard OIDC clients
    Given multiple OIDC connectors are configured
    When I open connectors
    Then the existing sign-in provider inventory remains visible
    And a separate OIDC connectors table appears below it
    And I can create, edit, enable for login, and delete each OIDC connector independently

  @entrypoint:product-ui @journey:admin-sign-in-settings
  Scenario: Sign-in settings persist legal links and hosted auth copy
    When I update sign-in settings
    Then hosted auth uses the saved settings

  @entrypoint:product-ui @journey:admin-sign-in-experience-routes
  Scenario: Sign-in experience tabs use canonical Console routes
    When I navigate sign-in experience tabs
    Then the browser URL uses canonical Console routes

  @entrypoint:product-ui @journey:admin-account-center-settings
  Scenario: Account Center settings change profile visibility
    When I update Account Center settings
    Then profile visibility changes for end users

  @entrypoint:product-ui @journey:admin-content-settings
  Scenario: Hosted content settings save through the management API
    When I update hosted copy and legal links
    Then the management API persists the content settings

  @entrypoint:product-ui @journey:admin-security-policy
  Scenario: Security pages show policy, CAPTCHA, blocklist, and general settings
    When I open security settings
    Then MFA policy, CAPTCHA, blocklist, and general settings are visible

  @entrypoint:product-ui @journey:admin-create-organization
  Scenario: Organizations page creates an organization
    When I create an organization
    Then it appears in authorization inventory

  @entrypoint:product-ui @journey:admin-create-role
  Scenario: Roles page creates a role
    When I create a role
    Then it appears in authorization inventory
    And the role can reference scopes declared by its API resource OpenAPI contract

  @entrypoint:product-ui @journey:admin-create-api-resource
  Scenario: API resources page creates an API resource
    When I create an API resource
    Then it appears in authorization inventory
    And its protected resource URL is the OAuth resource identifier and access-token audience
    And the business resource server OpenAPI contract remains the scope authority
    And the Console does not provide scope creation or editing

  @entrypoint:product-ui @journey:admin-archive-api-resource
  Scenario: API resource settings archive and restore a resource
    Given an API resource exists
    When I archive the API resource from its settings
    Then the Console asks me to confirm that existing authorization will be revoked
    When I confirm the archive
    Then the Console marks it archived and offers restoration
    When I restore the API resource
    Then the Console marks it disabled and does not enable it automatically

  @entrypoint:product-ui @journey:admin-authorization-inventory
  Scenario: Authorization inventory lists organizations, roles, and API resources
    Given authorization resources exist
    When I open the authorization pages
    Then organizations, roles, and API resources are listed

  @entrypoint:product-ui @journey:admin-branding-settings
  Scenario: Branding settings update hosted auth
    When I update branding settings
    Then hosted auth renders the saved branding

  @entrypoint:product-ui @journey:admin-deployment-settings
  Scenario: Deployment page shows Cloudflare runtime settings
    When I open deployment settings
    Then Cloudflare runtime configuration is visible

  @entrypoint:product-ui @journey:admin-application-oidc-claims
  Scenario: Application detail configures OIDC claim settings
    Given an application exists
    When I configure organization and RBAC claims for access tokens, ID tokens, and userinfo
    Then the Console saves the claim settings through the Management API
    And the application detail shows the saved claim settings after reload

  @entrypoint:product-ui @journey:oidc-claim-emission
  Scenario: Applications apply configured OIDC claim emission per token destination
    Given an application has organization membership, resource roles, and approved resource scopes
    When OIDC claims are configured for access tokens, ID tokens, and userinfo
    Then issued tokens identify relevant organizations in groups
    And identify effective resource roles in roles
    And carry only approved scopes

  @entrypoint:product-ui @journey:agent-discovery
  Scenario: AgentAuth discovery exposes a narrow delegated protocol surface
    When an agent client requests /.well-known/agent-configuration
    Then Realmroot advertises delegated mode and device authorization approval
    And the advertised capabilities include read-only account data and explicit resource scopes
    And the advertised endpoints, issuer, and proof algorithms are authoritative for the client
    And individual Management API operations are not generated as AgentAuth capabilities

  @entrypoint:product-ui @journey:admin-agent-inventory
  Scenario: Admins govern Agents without managing protocol internals
    Given delegated AgentAuth hosts, agents, grants, and approval requests exist
    When Console reads the tenant Agent inventory
    Then Realmroot presents stable Agents, access requests, access grants, account connections, and audit events
    And it does not expose hosts, registrations, bindings, or protocol approval records as management resources
    When an admin retires an Agent or revokes an access grant
    Then the Agent or grant is no longer active
    And no autonomous agent mode or broad admin mutation capability is enabled
