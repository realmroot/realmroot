Feature: Admin Console
  As a Realm platform administrator
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

  @entrypoint:product-ui @journey:admin-platform-only
  Scenario: Organization authority does not grant Console access
    Given I am an Organization Owner without Realm platform authority
    When I open a Console route
    Then I am redirected to my Organizations page
    And Realm management API data requests are not made

  @e2e @entrypoint:product-ui @journey:organization-workspace-platform-boundary
  Scenario: Organization Owners use their Workspace without Console authority
    Given I am an Organization Owner without Realm platform authority
    When I open my Organization Workspace and navigate its resource sections
    Then the Organization remains the explicit resource boundary
    When I open Console
    Then I am redirected to my Organizations page before Realm inventory loads

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
    And the Console has no Organization context switch or context query state
    And breadcrumbs link to the Realm Console and parent collection without repeating navigation groups
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
    And it records OIDC scopes separately from Resource-server-qualified scope allowlists
    And Resource Server and scope allowlists are bounded at the request boundary
    And native clients can be created with device login enabled
    And a client-credentials-only Application does not require a redirect URI

  @entrypoint:product-ui @journey:admin-application-detail
  Scenario: Application detail manages lifecycle, redirects, integration details, and secret rotation
    Given an application exists
    When I open its detail page
    Then settings, branding, redirect URIs, integration details, and secret rotation are available
    And Resource access is visible only when the Application can act as a machine principal
    And User authorizations remain separate from Application Permissions
    And active user authorizations are read from the Application authorization subresource collection
    And revoking one removes the active authorization while preserving its audit history
    And rotating a client secret requires confirmation because the current secret stops working
    And enabling refresh tokens keeps the required offline access scope selected
    And saving authorization silently removes allowlist references to deleted Resource Servers
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
    And direct Resource Server assignments are managed from Permissions
    And Authorized apps shows only the User's active Application authorization subresources

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
    And the authenticated creator becomes its Owner without an owner field in the request

  @entrypoint:product-ui @journey:admin-govern-organization
  Scenario: Organization detail separates inventory from governance operations
    Given an organization exists
    When I select it from the Realm inventory
    Then I enter its canonical Organization Workspace
    And I can review its overview, members, Roles, Agent identities, technical resources, activity, and settings in separate routes
    And only pending invitations are counted and offered as member actions
    And the last Organization Owner cannot be demoted or removed through generic member actions
    And profile changes and lifecycle operations use a secondary management surface
    And deleting an Organization returns to inventory without refetching its removed detail
    And Realm Console retains only the cross-Organization inventory

  @entrypoint:product-ui @journey:admin-create-role
  Scenario: Organization Roles page creates a dynamic role
    Given I selected an Organization where my membership grants roles:write
    When I create a dynamic role
    Then it appears in authorization inventory
    And the Organization Role can include only assigned scopes from visible Resource Servers
    And its stable Role key cannot be changed after creation
    And another Role in the same Organization cannot reuse its key
    And predefined Roles remain readable but cannot be modified or deleted
    And an assigned dynamic Role cannot be deleted

  @entrypoint:product-ui @journey:admin-create-api-resource
  Scenario: Resource servers page creates a Resource server
    When I create a Resource server
    Then it appears in authorization inventory
    And it records an explicit owner Organization
    And its visibility is private by default and can be changed to public
    And I explicitly select Realmroot, external OAuth, or brokered provider access
    And Realmroot access forbids a Provider Connector
    And external OAuth access requires a standard OIDC Connector
    And brokered provider access requires its Provider Connector without changing Realmroot token validation
    And the Connector association no longer determines the Resource Server access mode
    And its access mode and Provider Connector cannot change after creation
    And its protected resource URL is the OAuth resource identifier and access-token audience
    And its name and description are synchronized from the OpenAPI contract and cannot be edited manually
    And OAuth scopes advertised by the business resource server protected-resource metadata remain the scope authority
    And its OpenAPI contract may add scope descriptions and maps protected operations only to advertised scopes
    And its Scopes tab manages each discovered scope's automatic or assigned grant mode
    And its Endpoints tab lists protected operations and required scope sets derived from that contract
    And external authorization connection details are included in Overview
    And Organization Roles and direct Permissions remain managed from their owning resources

  @entrypoint:product-ui @journey:admin-delete-api-resource
  Scenario: API resource settings soft-delete a resource
    Given an API resource exists
    When I delete the API resource from its settings
    Then the Console asks me to confirm that existing authorization will be revoked
    When I confirm the deletion
    Then the Console removes it from resource lists and details
    And the deleted resource remains only in the database for incident investigation
    And the Console offers no restoration

  @entrypoint:product-ui @journey:provider-connection-authority
  Scenario: A Provider Connector has one generic account connection authority
    Given a Resource Server advertises brokered account connection metadata
    When I register it without a Provider Connector
    Then Realmroot rejects the Resource Server
    When I register it with an enabled Provider Connector
    Then Realmroot accepts any Connector provider type without requiring an external OIDC authorization server
    And refreshing discovery preserves the brokered account connection endpoints
    And Realmroot rejects another account connection authority for the same Provider Connector

  @entrypoint:product-ui @journey:admin-authorization-inventory
  Scenario: Authorization inventory lists organizations, Organization Roles, and Resource servers
    Given authorization resources exist
    When I open the authorization pages
    Then organizations, roles, and Resource servers are listed
    And each Organization member exposes its sorted Role keys
    And replacing member Roles rejects unknown and cross-Organization Role keys
    And the last Owner cannot be removed by a Role replacement
    And each dynamic Role references only assigned scopes from visible Resource servers

  @entrypoint:product-ui @journey:admin-resource-permissions
  Scenario: Permissions are explicit authorization resources
    Given a visible Resource Server has assigned scopes
    When an authorized administrator grants scopes directly to a User or Application
    Then User Permissions are managed only below the target User
    And Application Permissions are managed only below the target Application
    And only Applications configured as machine principals accept Application Permissions
    And a delegated Agent administrator is recorded as the Permission grantor without impersonating a User
    And each Permission has an independent lifetime, canonical URI, and audit identity
    And Permission lists show only active records unless inactive history is requested
    And each subject exposes a searchable Authorized Resource Server collection derived from active Permissions
    And each Authorized Resource Server is a flat Resource Server summary with its active Permission count
    And assigning another scope never shortens or replaces an existing Permission
    And direct Permissions combine with optional Organization Role scopes
    But public visibility does not automatically grant any assigned scope

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
    And Organization Workspace can list and manage only endpoints and deliveries scoped to its Organization
    And endpoint and request filters form the header of the same surface as their active table
    And invalid endpoint URLs remain actionable inside the form

  @entrypoint:product-ui @journey:webhook-event-delivery
  Scenario: Subscribed product events are signed, delivered, and auditable
    Given an enabled webhook endpoint subscribes to a supported product event
    When that product event occurs
    Then Realmroot posts a stable JSON event envelope to the endpoint
    And an Organization-scoped endpoint receives only events applicable to that Organization
    And the request includes an event id and event type and uses the Resource Server Application's client-credentials access token
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
  Scenario: Organization creation is independent from platform Console access
    When I configure Realm developer access
    Then I can choose an Organization creation policy without changing Console access
    And Console access is displayed as restricted to Realm platform administrators
    And Organization access levels are not offered as Console access controls
    And changing an Organization access level never grants business API scopes

  @entrypoint:product-ui @journey:organization-console-resource-boundary
  Scenario: Organization administration uses the Organization Workspace
    Given a developer administers one Organization without Realm platform authority
    When the developer browses or manages resources in that Organization Workspace
    Then applications and API resource servers are limited to that Organization's owned inventory
    And Webhooks and audit activity are limited to that Organization
    And Organization Roles can be defined and assigned without entering Console
    And Agent identities and activity are limited to authorized Organizations
    And member inventory exposes identity details without Realm-wide authentication state
    And direct detail or mutation requests for another Organization's resources are rejected
    And Realm operators retain the complete Realm inventory in Console

  @entrypoint:product-ui @journey:admin-agent-governance-detail
  Scenario: Agent detail presents the stable identity governance model
    Given a stable Agent identity has bound Hosts, access requests, and Permissions
    When I open the Agent detail in Console
    Then its inventory summary uses real active Resource and scope counts
    And separate tabs show Agent installations, Permissions, audit activity, and settings
    And Resource access reads the Agent's Authorized Resource Servers and shows only the selected Resource Server's Permissions
    And each Permission reports its active or ended status separately from its end reason
    And audit activity supports searching and filtering Agent governance history
    And Agent access request history is available through audit activity instead of a separate detail tab
    And those tabs compose canonical Permission and audit collections
    And Permission collections omit history associated with deleted Resource Servers
    And protocol Agent implementation records and credential material are not exposed

  @entrypoint:product-ui @journey:admin-application-oidc-claims
  Scenario: Application detail configures OIDC claim settings
    Given an application exists
    When I configure organization and RBAC claims for access tokens, ID tokens, and userinfo
    Then the Console saves the claim settings through the Management API
    And the application detail shows the saved claim settings after reload

  @entrypoint:product-ui @journey:oidc-claim-emission
  Scenario: Applications apply configured OIDC claim emission per token destination
    Given a user has organization membership, optional resource roles, and approved resource scopes
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
    Given delegated AgentAuth hosts, Agents, Permissions, and approval requests exist
    When Console reads the tenant Agent inventory
    Then Realmroot presents stable Agents, access requests, Permissions, account connections, and audit events
    And it does not expose hosts, registrations, bindings, or protocol approval records as management resources
    When an admin deletes an Agent or revokes a Permission
    Then the Agent or Permission is no longer active
    And no autonomous agent mode or broad admin mutation capability is enabled
