Feature: Admin Console
  As a Realm platform administrator
  I want Console pages to manage applications, users, connectors, security, and deployment settings
  So that Realmroot can be configured from the browser

  Background:
    Given a first admin exists
    And I am signed in to Console

  @entrypoint:product-ui @journey:admin-dashboard @proof:unit
  Scenario: Admin dashboard loads tenant health
    When I open /console
    Then the dashboard shows tenant health from real management APIs

  @entrypoint:product-ui @journey:admin-signed-out-redirect @proof:unit
  Scenario: Signed-out Console routes redirect before data loads
    Given I am signed out
    When I open a Console route
    Then I am redirected to admin sign-in
    And management API data requests are not made

  @entrypoint:product-ui @journey:admin-platform-only @proof:unit
  Scenario: Organization authority does not grant Console access
    Given I am an Organization Owner without Realm platform authority
    When I open a Console route
    Then I am redirected to my Organizations page
    And Realm management API data requests are not made

  @e2e @entrypoint:product-ui @journey:organization-workspace-platform-boundary @proof:e2e
  Scenario: Organization Owners use their Workspace without Console authority
    Given I am an Organization Owner without Realm platform authority
    When I open my Organization Workspace and navigate its resource sections
    Then the Organization remains the explicit resource boundary
    When I open Console
    Then I am redirected to my Organizations page before Realm inventory loads

  @entrypoint:product-ui @journey:admin-setup-gate @proof:unit
  Scenario: Console setup gate handles missing OIDC applications
    Given no OIDC application exists
    When I open Console
    Then setup guidance is shown without blocking persistent Console routes

  @entrypoint:product-ui @journey:admin-route-backed-navigation @proof:unit
  Scenario: Console navigation exposes persistent route-backed pages
    When I use Console navigation
    Then each visible product page has a canonical route
    And the Console has no Organization context switch or context query state
    And breadcrumbs link to the Realm Console and parent collection without repeating navigation groups
    And breadcrumb labels match the actual route-backed page or selected tab
    And the current page is identified without a redundant link
    And primary Console pages use a compact page header before their navigation or data controls
    And primary inventory filters form the header of the same surface as their table
    And API documentation opens in a separate browsing context

  @entrypoint:product-ui @journey:admin-application-inventory @proof:unit
  Scenario: Applications page lists OIDC clients and status controls
    Given OIDC applications exist
    When I open the applications page
    Then clients and lifecycle controls are visible

  @entrypoint:product-ui @journey:admin-create-application @proof:unit
  Scenario: Applications page creates a typed OAuth client
    When I create an application from Console
    Then the new Application appears in inventory as confidential_web, public_spa, public_native, or machine
    And it records an explicit owner Organization
    And its Application type derives grant types, client authentication, PKCE, and OIDC scopes
    And Machine Applications receive client credentials without a redirect URI or user scopes
    And Web, SPA, and Native Applications require a redirect URI
    And the Console and Management API use the same four Application types
    And it records Resource-server-qualified scope allowlists separately from granted Permissions
    And Resource Server and scope allowlists are bounded at the request boundary
    And Public Native Applications can enable or disable device login
    And new Applications are private by default while migrated Applications remain public

  @entrypoint:product-ui @journey:admin-application-detail @proof:unit
  Scenario: Application detail manages lifecycle, redirects, integration details, and secret rotation
    Given an application exists
    When I open its detail page
    Then settings, branding, redirect URIs, integration details, and secret rotation are available
    And Resource access is visible only when the Application can act as a machine principal
    And the owner Organization is immutable after creation
    And User authorizations remain separate from Application Permissions
    And only Applications owned by the Realmroot Platform Organization can configure whether user consent is required
    And active user authorizations are read from the Application authorization subresource collection
    And revoking one removes the active authorization while preserving its audit history
    And rotating a client secret requires confirmation because the current secret stops working
    And enabling refresh tokens keeps the required offline access scope selected
    And saving authorization silently removes allowlist references to deleted Resource Servers
    And deleting it returns to inventory without refetching the removed client
    And visibility can be changed between public and private independently from OAuth client authentication

  @entrypoint:product-ui @journey:admin-create-user @proof:unit
  Scenario: Users page creates a user
    When I create a user from Console
    Then the user is persisted through the management API

  @entrypoint:product-ui @journey:admin-user-inventory @proof:unit
  Scenario: Users page supports search and status inventory
    Given users exist
    When I open the users page
    Then user search and status inventory are visible

  @entrypoint:product-ui @journey:admin-user-detail @proof:unit
  Scenario: User detail updates profile, resets password, and revokes sessions
    Given a user exists
    When I open user detail
    Then profile update, password reset, and session revocation controls work
    And direct Resource Server assignments are managed from Permissions
    And Authorized apps shows only the User's active Application authorization subresources

  @entrypoint:product-ui @journey:admin-create-connector @proof:unit
  Scenario: Connectors page creates a draft social connector
    When I create a social connector from Console
    Then the connector is saved as a draft

  @entrypoint:product-ui @journey:admin-connector-inventory @proof:unit
  Scenario: Connectors page lists email and SMS setup state
    When I open connectors
    Then Email and SMS setup state is visible

  @entrypoint:product-ui @journey:admin-social-connector-inventory @proof:unit
  Scenario: Social connectors list provider settings and availability
    When I open social connector settings
    Then provider settings and availability are visible
    And provider rows and hosted sign-in methods show a recognizable provider icon

  @entrypoint:product-ui @journey:admin-oidc-connector-inventory @proof:unit
  Scenario: Connectors page manages multiple standard OIDC clients
    Given multiple OIDC connectors are configured
    When I open connectors
    Then the existing sign-in provider inventory remains visible
    And standard page-level navigation tabs switch between built-in and OIDC connector inventories
    And each active inventory renders below the tabs in a unified data-list surface
    And inventory filters form the header of the same surface as their table
    And I can create, edit, enable for login, and delete each OIDC connector independently

  @entrypoint:product-ui @journey:admin-sign-in-settings @proof:unit
  Scenario: Sign-in settings persist registration and method availability
    When I update registration rules or hosted sign-in method availability
    Then hosted auth uses the saved availability settings
    And the active settings tab saves atomically from its inline form

  @entrypoint:product-ui @journey:admin-sign-in-experience-routes @proof:unit
  Scenario: Sign-in experience tabs use canonical Console routes
    When I navigate sign-in experience tabs
    Then the browser URL uses canonical Console routes

  @entrypoint:product-ui @journey:admin-account-center-settings @proof:unit
  Scenario: Account Center settings change profile visibility
    When I update Account Center settings
    Then profile visibility changes for end users

  @entrypoint:product-ui @journey:admin-content-settings @proof:unit
  Scenario: Hosted legal and support destinations save through the management API
    When I update hosted legal and support destinations
    Then the management API persists the Terms, Privacy, and Support URLs
    And the hosted preview footer uses them

  @entrypoint:product-ui @journey:admin-security-policy @proof:unit
  Scenario: Security pages show policy, CAPTCHA, blocklist, and general settings
    When I open security settings
    Then MFA policy, CAPTCHA, blocklist, and general settings are visible
    And the active settings tab is edited and saved inline without opening a drawer
    And session lifetimes can be managed without deployment environment variables
    And CAPTCHA can be configured with a supported provider and that provider's required credentials
    And CAPTCHA secrets are stored by the management plane without being returned to Console
    And canceling a policy editor discards every unsaved controlled value

  @entrypoint:product-ui @journey:admin-require-mfa-safely @proof:unit
  Scenario: An operator cannot require MFA before enrolling it
    Given my operator account has not enrolled MFA
    When I change the Realm MFA policy from optional to required
    Then Realmroot rejects the change with enrollment guidance
    And the current Console session remains usable

  @entrypoint:product-ui @journey:admin-create-organization @proof:unit
  Scenario: Organizations page creates an organization
    When I create an organization
    Then it appears in authorization inventory
    And the authenticated creator becomes its Owner without an owner field in the request

  @entrypoint:product-ui @journey:admin-govern-organization @proof:unit
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

  @entrypoint:product-ui @journey:admin-create-role @proof:unit
  Scenario: Organization Roles page creates a dynamic role
    Given I selected an Organization where my membership grants roles:write
    When I create a dynamic role
    Then it appears in authorization inventory
    And the creation form initializes it without Scope assignments
    And the Organization Role can include only assigned scopes from visible Resource Servers
    And its stable Role key cannot be changed after creation
    And another Role in the same Organization cannot reuse its key
    And predefined Roles remain readable but cannot be modified or deleted
    And an assigned dynamic Role cannot be deleted

  @entrypoint:product-ui @journey:admin-create-api-resource @proof:unit
  Scenario: Resource servers page creates a Resource server
    When I create a Resource server
    Then it appears in authorization inventory
    And it records an explicit owner Organization
    And its visibility is private by default and can be changed to public
    And I explicitly select Native or External authorization
    And Native authorization uses no Provider Connector and trusts Realmroot as the final token issuer
    And External authorization requires one Connector whose resource-authorization facet matches the advertised issuer
    And the Console reports Realmroot or the external issuer as the final token issuer
    And the authorization model cannot change after creation while an External Resource Server's compatible Connector can be replaced explicitly
    And its protected resource URL is the OAuth resource identifier and access-token audience
    And its name and description are synchronized from the OpenAPI contract and cannot be edited manually
    And OAuth scopes advertised by the business resource server protected-resource metadata remain the scope authority
    And its OpenAPI contract may add scope descriptions and maps protected operations only to advertised scopes
    And its Scopes tab manages each discovered scope's automatic or assigned grant mode
    And its Endpoints tab lists protected operations and required scope sets derived from that contract
    And external authorization connection details are included in Overview
    And Organization Roles and direct Permissions remain managed from their owning resources

  @entrypoint:product-ui @journey:admin-delete-api-resource @proof:unit
  Scenario: API resource settings soft-delete a resource
    Given an API resource exists
    When I delete the API resource from its settings
    Then the Console asks me to confirm that existing authorization will be revoked
    When I confirm the deletion
    Then the Console removes it from resource lists and details
    And the deleted resource remains only in the database for incident investigation
    And the Console offers no restoration

  @entrypoint:product-ui @journey:provider-connection-authority @proof:unit
  Scenario: One Provider Connector exposes independent authentication and resource-authorization facets
    Given a Connector driver supports authentication and resource authorization
    When I configure its Better Auth authentication client and its external authorization issuer
    Then the Console keeps both capabilities under one Provider Connector
    And the two facets use independent clients, callbacks, state, token storage, and lifecycle
    And a Resource Server can reference only the external authorization facet
    And disabling authentication does not disable its Resource Servers or existing resource connections

  @entrypoint:product-ui @journey:admin-authorization-inventory @proof:unit
  Scenario: Authorization inventory lists organizations, Organization Roles, and Resource servers
    Given authorization resources exist
    When I open the authorization pages
    Then organizations, roles, and Resource servers are listed
    And each Organization member exposes its sorted Role keys
    And replacing member Roles rejects unknown and cross-Organization Role keys
    And the last Owner cannot be removed by a Role replacement
    And each dynamic Role references only assigned scopes from visible Resource servers

  @entrypoint:product-ui @journey:admin-resource-permissions @proof:unit
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

  @entrypoint:product-ui @journey:admin-branding-settings @proof:unit
  Scenario: Color schemes and brand assets update hosted auth
    When I choose a color scheme or update brand asset URLs
    Then the live preview updates before save
    And each Experience tab uses the standard inline form actions to discard or save its changes
    And save and discard actions remain disabled until the active tab changes
    And the custom scheme exposes only Primary, Page background, Surface, Text, and Border
    And the preview has no viewport switcher or separate open-page action
    And the preview remains fixed in the right column without a separate preview header while only the form column scrolls
    And hosted auth renders the saved branding

  @entrypoint:product-ui @journey:admin-webhook-endpoint-lifecycle @proof:unit
  Scenario: Administrators manage webhook endpoints from Console
    Given I am signed in to Console as a Realm administrator
    When I create, edit, disable, enable, rotate, and delete a webhook endpoint
    Then each endpoint change is persisted
    And each endpoint is explicitly Realm-wide or scoped to one Organization
    And Organization Workspace can list and manage only endpoints and deliveries scoped to its Organization
    And endpoint and request filters form the header of the same surface as their active table
    And invalid endpoint URLs remain actionable inside the form

  @entrypoint:product-ui @journey:webhook-event-delivery @proof:integration
  Scenario: Subscribed product events are signed, delivered, and auditable
    Given an enabled webhook endpoint subscribes to a supported product event
    When that product event occurs
    Then Realmroot posts a stable JSON event envelope to the endpoint
    And an Organization-scoped endpoint receives only events applicable to that Organization
    And the request includes an event id and event type and uses the Resource Server Application's client-credentials access token
    And every delivery attempt and bounded response is recorded as an independently addressable resource
    And large request or response bodies remain scrollable without hiding request actions
    And retrying a failed delivery creates a new signed delivery attempt under the original request

  @entrypoint:product-ui @journey:admin-deployment-settings @proof:unit
  Scenario: Deployment page shows Cloudflare runtime settings
    When I open deployment settings
    Then Cloudflare runtime configuration is visible

  @entrypoint:product-ui @journey:admin-general-settings @proof:unit
  Scenario: General Realm settings persist through the management plane
    When I update the Realm name in General settings
    Then the management API persists it on the canonical Realm resource
    And the setting is edited and saved directly in the General tab
    And hosted product surfaces use the saved Realm name
    And protocol endpoints remain derived from the canonical Realm origin

  @entrypoint:product-ui @journey:admin-email-delivery-settings @proof:unit
  Scenario: Email delivery settings persist independently from deployment variables
    Given the deployment exposes a Cloudflare Email binding
    When I configure the sender identity in Email delivery settings
    Then the management API replaces the Email delivery configuration resource
    And a stale representation retries only when the editable configuration is unchanged
    And edge delivery preserves the strong version validator used for conditional writes
    And authentication messages use the stored sender configuration
    And Console reports the binding and configuration state separately

  @entrypoint:product-ui @journey:admin-developer-access-policy @proof:unit
  Scenario: Organization creation is independent from platform Console access
    When I configure Realm developer access
    Then I can choose an Organization creation policy without changing Console access
    And Console access is displayed as restricted to Realm platform administrators
    And Organization access levels are not offered as Console access controls
    And changing an Organization access level never grants business API scopes

  @entrypoint:product-ui @journey:admin-organization-creation-policy @proof:unit
  Scenario: Realm operators control who may create Organizations
    Given Organization creation is governed independently from Console access
    When a Realm operator changes the Organization creation policy
    Then the policy can allow all users, Realm operators only, or an explicit set of users
    And every referenced user must exist before the policy is saved
    And an invalid reference leaves the previous policy unchanged
    And the policy change does not grant Console or business API authority

  @entrypoint:product-ui @journey:organization-console-resource-boundary @proof:unit
  Scenario: Organization administration uses the Organization Workspace
    Given a developer administers one Organization without Realm platform authority
    When the developer browses or manages resources in that Organization Workspace
    Then applications and API resource servers are limited to that Organization's owned inventory
    And Webhooks and audit activity are limited to that Organization
    And Organization Roles can be defined and assigned without entering Console
    And Agent identities are not part of Organization-owned inventory
    And Organization activity excludes User-owned Agent governance events
    And member inventory exposes identity details without Realm-wide authentication state
    And direct detail or mutation requests for another Organization's resources are rejected
    And Realm operators retain the complete Realm inventory in Console

  @entrypoint:product-ui @journey:admin-agent-governance-detail @proof:unit
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

  @entrypoint:product-ui @journey:admin-application-oidc-claims @proof:unit
  Scenario: Application detail exposes one platform token profile
    Given an application exists
    When I inspect or update the Application through the Console or Management API
    Then the Console exposes no per-Application OIDC claim settings
    And the Management API accepts legacy oidcClaims input without applying it and returns the fixed platform profile for migration compatibility
    And existing stored claim settings do not alter newly issued tokens

  @entrypoint:product-ui @journey:oidc-claim-emission @proof:integration
  Scenario: Applications receive standard identity and access token claims
    Given a user has organization membership, optional resource roles, and approved resource scopes
    When the Application completes an OIDC authorization flow for a Resource Server
    Then a private Application ID token identifies exactly one owner Organization in the string claim urn:realmroot:params:oauth:org
    And an authorized groups scope adds only the User's Team names from that Organization to the ID token
    And the ID token contains no Realmroot roles, permission rules, or Resource scopes
    And the access token is an RFC 9068 JWT containing client_id, audience, subject, lifetime, token identifier, and approved scope
    And the access token identifies Team names from the current Organization in groups
    And identifies effective resource roles in roles
    And carries the same string Organization context in urn:realmroot:params:oauth:org
    And no token carries the legacy object claim urn:realmroot:params:oauth:tenant
    But the access token contains no duplicate authorization object, azp, application_id, or top-level organization_id

  @entrypoint:product-ui @journey:oidc-group-application-boundary @proof:integration
  Scenario: One group-aware Application can serve multiple relying-party instances
    Given an Organization owns one public native Kubernetes Application and one confidential web Argo CD Application
    When multiple Kubernetes clusters use the native client and multiple Argo CD instances register callbacks on the web client
    Then every instance receives the same Organization-scoped Team groups for the same User
    And each relying party maps those groups to its own local authorization roles
    But Kubernetes and Argo CD do not share an Application or client secret boundary

  @entrypoint:product-ui @journey:agent-discovery @proof:unit
  Scenario: AgentAuth discovery exposes a narrow delegated protocol surface
    When an agent client requests /.well-known/agent-configuration
    Then Realmroot advertises delegated mode and device authorization approval
    And AgentAuth advertises no Resource API capabilities
    And the advertised endpoints, issuer, and proof algorithms are authoritative for the client
    And Management API authority is expressed only as OAuth scopes

  @entrypoint:product-ui @journey:admin-agent-inventory @proof:unit
  Scenario: Admins govern Agents without managing protocol internals
    Given delegated AgentAuth hosts, Agents, Permissions, and approval requests exist
    When Console reads the tenant Agent inventory
    Then Realmroot presents stable Agents, access requests, Permissions, account connections, and audit events
    And large Agent inventories can be traversed one bounded server page at a time
    And it does not expose hosts, registrations, bindings, or protocol approval records as management resources
    When an admin deletes an Agent or revokes a Permission
    Then the Agent or Permission is no longer active
    And no autonomous agent mode or broad admin mutation capability is enabled
