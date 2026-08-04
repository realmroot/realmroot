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

  @entrypoint:product-ui @journey:admin-onboarding-complete
  Scenario: Completed Console setup does not offer another first client
    Given an OIDC application and a sign-in method already exist
    When I reopen Console onboarding
    Then I am redirected to the Console dashboard

  @entrypoint:product-ui @journey:admin-route-backed-navigation
  Scenario: Console navigation exposes persistent route-backed pages
    When I use Console navigation
    Then each visible product page has a canonical route
    And breadcrumbs link to the current Console context and parent collection without repeating navigation groups
    And breadcrumb labels match the actual route-backed page or selected tab
    And the current page is identified without a redundant link
    And primary Console pages use a compact page header before their navigation or data controls
    And primary inventory filters form the header of the same surface as their table

  @entrypoint:product-ui @journey:admin-application-inventory
  Scenario: Applications page lists OIDC clients and status controls
    Given OIDC applications exist
    When I open the applications page
    Then clients and lifecycle controls are visible

  @entrypoint:product-ui @journey:admin-create-application
  Scenario: Applications page creates an OIDC client
    When I create an application from Console
    Then the new OIDC client appears in inventory
    And it records an explicit owner Organization
    And its audience independently supports all Realm users, selected Organizations, assigned users, or public registration
    And native clients can be created with device login enabled

  @entrypoint:product-ui @journey:admin-application-detail
  Scenario: Application detail manages lifecycle, redirects, integration details, and secret rotation
    Given an application exists
    When I open its detail page
    Then settings, branding, redirect URIs, integration details, and secret rotation are available
    And active user authorizations are read from the canonical Application authorization collection
    And revoking one creates its durable revocation state without deleting its authorization history
    And rotating a client secret requires confirmation because the current secret stops working
    And enabling refresh tokens keeps the required offline access scope selected
    And deleting it returns to inventory without refetching the removed client

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
    And provider rows and hosted sign-in methods show a recognizable provider icon

  @entrypoint:product-ui @journey:admin-oidc-connector-inventory
  Scenario: Connectors page manages multiple standard OIDC clients
    Given multiple OIDC connectors are configured
    When I open connectors
    Then the existing sign-in provider inventory remains visible
    And standard page-level navigation tabs switch between built-in and OIDC connector inventories
    And each active inventory renders below the tabs in a unified data-list surface
    And inventory filters form the header of the same surface as their table
    And I can create, edit, enable for login, and delete each OIDC connector independently

  @entrypoint:product-ui @journey:admin-sign-in-settings
  Scenario: Sign-in settings persist registration and method availability
    When I update registration rules or hosted sign-in method availability
    Then hosted auth uses the saved availability settings
    And the active settings tab saves atomically from its inline form

  @entrypoint:product-ui @journey:admin-sign-in-experience-routes
  Scenario: Sign-in experience tabs use canonical Console routes
    When I navigate sign-in experience tabs
    Then the browser URL uses canonical Console routes

  @entrypoint:product-ui @journey:admin-account-center-settings
  Scenario: Account Center settings change profile visibility
    When I update Account Center settings
    Then profile visibility changes for end users

  @entrypoint:product-ui @journey:admin-content-settings
  Scenario: Hosted legal and support destinations save through the management API
    When I update hosted legal and support destinations
    Then the management API persists the Terms, Privacy, and Support URLs
    And the hosted preview footer uses them

  @entrypoint:product-ui @journey:admin-security-policy
  Scenario: Security pages show policy, CAPTCHA, blocklist, and general settings
    When I open security settings
    Then MFA policy, CAPTCHA, blocklist, and general settings are visible
    And the active settings tab is edited and saved inline without opening a drawer
    And session lifetimes can be managed without deployment environment variables
    And CAPTCHA can be configured with a supported provider and that provider's required credentials
    And CAPTCHA secrets are stored by the management plane without being returned to Console
    And canceling a policy editor discards every unsaved controlled value

  @entrypoint:product-ui @journey:admin-require-mfa-safely
  Scenario: An operator cannot require MFA before enrolling it
    Given my operator account has not enrolled MFA
    When I change the Realm MFA policy from optional to required
    Then Realmroot rejects the change with enrollment guidance
    And the current Console session remains usable

  @entrypoint:product-ui @journey:admin-create-organization
  Scenario: Organizations page creates an organization
    When I create an organization
    Then it appears in authorization inventory

  @entrypoint:product-ui @journey:admin-govern-organization
  Scenario: Organization detail separates inventory from governance operations
    Given an organization exists
    When I open its Console detail
    Then I can review its overview, members, Agent identities, activity, and settings in separate tabs
    And only pending invitations are counted and offered as member actions
    And the last Organization Owner cannot be demoted or removed through generic member actions
    And profile changes and lifecycle operations use a secondary management surface
    And deleting an Organization returns to inventory without refetching its removed detail
    And applications and Resource servers remain in the shared Develop inventory

  @entrypoint:product-ui @journey:admin-create-role
  Scenario: Roles page creates a role
    When I create a role
    Then it appears in authorization inventory
    And the Realm-global role can include Resource-server-qualified permissions from multiple contracts
    And its stable Role key cannot be changed after creation
    And another Role cannot reuse the same Realm-global key
    And its detail exposes only backed permission, assignment, metadata, and lifecycle surfaces
    And deleting a custom Role explicitly warns that its active and historical assignments are also removed

  @entrypoint:product-ui @journey:admin-create-api-resource
  Scenario: Resource servers page creates a Resource server
    When I create a Resource server
    Then it appears in authorization inventory
    And it records an explicit owner Organization
    And its access eligibility independently supports the owner Organization, selected Organizations, or the Realm
    And selecting an OIDC connector during creation makes it externally authorized
    And omitting a connector makes it natively authorized
    And its authorization mode cannot change after creation
    And its protected resource URL is the OAuth resource identifier and access-token audience
    And the business resource server OpenAPI contract remains the scope authority
    And the Console does not provide scope creation or editing
    And its Resources tab lists protected operations and required scope sets derived from that contract

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
  Scenario: Authorization inventory lists organizations, roles, and Resource servers
    Given authorization resources exist
    When I open the authorization pages
    Then organizations, roles, and Resource servers are listed
    And Role assignments identify their subject and optional Organization context
    And Role assignments remain a Realm-wide canonical inventory that can be filtered
    And revoking an assignment creates its durable idempotent revocation state without deleting its history
    And switching Console context preserves the current authorization page
    And each native Resource server lists Roles using its permissions and their active assignment counts

  @entrypoint:product-ui @journey:admin-branding-settings
  Scenario: Color schemes and brand assets update hosted auth
    When I choose a color scheme or update brand asset URLs
    Then the live preview updates before save
    And each Experience tab uses the standard inline form actions to discard or save its changes
    And save and discard actions remain disabled until the active tab changes
    And the custom scheme exposes only Primary, Page background, Surface, Text, and Border
    And the preview has no viewport switcher or separate open-page action
    And the preview remains fixed in the right column without a separate preview header while only the form column scrolls
    And hosted auth renders the saved branding

  @entrypoint:product-ui @journey:admin-webhook-endpoint-lifecycle
  Scenario: Administrators manage webhook endpoints from Console
    Given I am signed in to Console as a Realm administrator
    When I create, edit, disable, enable, rotate, and delete a webhook endpoint
    Then each endpoint change is persisted
    And each endpoint is explicitly Realm-wide or scoped to one Organization
    And Organization Console can list and manage only endpoints and deliveries scoped to its authorized Organization
    And endpoint and request filters form the header of the same surface as their active table
    And invalid endpoint URLs remain actionable inside the form

  @entrypoint:product-ui @journey:webhook-event-delivery
  Scenario: Subscribed product events are signed, delivered, and auditable
    Given an enabled webhook endpoint subscribes to a supported product event
    When that product event occurs
    Then Realmroot posts a stable JSON event envelope to the endpoint
    And an Organization-scoped endpoint receives only events applicable to that Organization
    And the request includes an event id, timestamp, event type, and HMAC signature
    And every delivery attempt and bounded response is recorded as an independently addressable resource
    And large request or response bodies remain scrollable without hiding request actions
    And retrying a failed delivery creates a new signed delivery attempt under the original request

  @entrypoint:product-ui @journey:admin-deployment-settings
  Scenario: Deployment page shows Cloudflare runtime settings
    When I open deployment settings
    Then Cloudflare runtime configuration is visible

  @entrypoint:product-ui @journey:admin-general-settings
  Scenario: General Realm settings persist through the management plane
    When I update the Realm name in General settings
    Then the management API persists it on the canonical Realm resource
    And the setting is edited and saved directly in the General tab
    And hosted product surfaces use the saved Realm name
    And protocol endpoints remain derived from the canonical Realm origin

  @entrypoint:product-ui @journey:admin-email-delivery-settings
  Scenario: Email delivery settings persist independently from deployment variables
    Given the deployment exposes a Cloudflare Email binding
    When I configure the sender identity in Email delivery settings
    Then the management API replaces the Email delivery configuration resource
    And authentication messages use the stored sender configuration
    And Console reports the binding and configuration state separately

  @entrypoint:product-ui @journey:admin-developer-access-policy
  Scenario: Organization creation and Console developer access are independent
    When I configure Realm developer access
    Then I can choose an Organization creation policy without changing Console access
    And I can choose a Console access policy and eligible Organization access levels independently
    And each policy is replaced through its own canonical resource
    And changing an Organization access level never grants business API scopes

  @entrypoint:product-ui @journey:organization-console-resource-boundary
  Scenario: Organization Console access is constrained to authorized inventory
    Given a developer can open Console for one Organization
    When the developer browses or manages development resources
    Then applications and API resource servers are limited to that Organization's owned inventory
    And Agent identities and activity are limited to authorized Organizations
    And member inventory exposes identity details without Realm-wide authentication state
    And direct detail or mutation requests for another Organization's resources are rejected
    And Realm operators retain the complete Realm inventory

  @entrypoint:product-ui @journey:admin-agent-governance-detail
  Scenario: Agent detail presents the stable identity governance model
    Given a stable Agent identity has bound Hosts, Role assignments, access requests, and access grants
    When I open the Agent detail in Console
    Then its inventory summary uses real active Role and access-grant counts
    And separate tabs show Agent installations, effective Roles, access requests, access grants, and audit activity
    And those tabs compose canonical Role assignment, Agent access request, Agent access grant, and audit collections
    And protocol Agent implementation records and credential material are not exposed

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
    And AgentAuth advertises no Resource API capabilities
    And the advertised endpoints, issuer, and proof algorithms are authoritative for the client
    And Management API authority is expressed only as OAuth scopes

  @entrypoint:product-ui @journey:admin-agent-inventory
  Scenario: Admins govern Agents without managing protocol internals
    Given delegated AgentAuth hosts, agents, grants, and approval requests exist
    When Console reads the tenant Agent inventory
    Then Realmroot presents stable Agents, access requests, access grants, account connections, and audit events
    And it does not expose hosts, registrations, bindings, or protocol approval records as management resources
    When an admin retires an Agent or revokes an access grant
    Then the Agent or grant is no longer active
    And no autonomous agent mode or broad admin mutation capability is enabled
