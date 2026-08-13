Feature: Unified Realmroot resource API
  As an Agent operator
  I want Restish to discover every operation from one Realmroot API contract
  So that every resource has one canonical URI and explicit authorization scopes

  Background:
    Given a first admin exists


  @entrypoint:restish @journey:management-resource-identifiers
  Scenario: Newly created resources use standard opaque identifiers
    When Realmroot creates a persistent resource or event record
    Then its identifier is a UUID version 7 without a resource-type prefix
    And existing prefixed identifiers remain valid resource references
    And credentials, tokens, protocol nonce values, and request trace identifiers retain their dedicated formats

  @entrypoint:restish @journey:management-openapi-discovery
  Scenario: The unified API contract is discoverable
    When an API client requests service discovery
    Then /api/openapi.json returns the OpenAPI 3.1 contract
    And /api/docs renders interactive API documentation from that contract
    And every operation is grouped under a declared domain tag
    And every Realm resource operation is grouped under the Platform tag
    And every Realmroot-owned API operation except Account Center, hosted OAuth UI, health, hosted configuration, first-run onboarding, and Better Auth protocol operations appears in the contract
    And API responses advertise that contract with Restish-compatible Link headers
    And the default hosted Restish profile targets https://id.realmroot.dev/api
    And Restish v2 exposes the current Agent and resource operations from the same contract
    And resources are not grouped under a management path
    And every protected operation declares its exact authorization scope through an OpenAPI security requirement
    And the contract declares agentAssertion, oauth2, and session-cookie security schemes
    And oauth2 identifies all Resource API credentials regardless of whether the principal is an Agent or Application
    And Agent Resource API operations use oauth2 while AgentAuth assertions remain limited to enrollment and token exchange
    And no API-key, capability extension, or plugin provider name appears as a public security scheme
    And Restish can validate structured authorization detail request bodies without the root OpenAPI document


  @entrypoint:agent-protocol @journey:agent-skills-discovery
  Scenario: Realmroot publishes instructions for Agents using its Toolbox
    When an Agent client requests /.well-known/agent-skills/index.json
    Then Realmroot returns the Agent Skills Discovery version 0.2.0 index
    And the index advertises every Realmroot-owned Skill as an archive
    And each archive contains the Skill instructions and supporting files
    And every advertised SHA-256 digest matches its archive bytes
    And the Realmroot Skill directs Agents to install task-relevant Skills advertised by a selected Resource Server


  @entrypoint:restish @journey:management-collection-envelope
  Scenario: Collection responses use one stable envelope
    When an authorized caller lists any growing resource collection
    Then the response exposes the resources through an items field
    And pagination metadata is exposed through a pagination field
    And no collection uses a resource-specific plural field as its envelope


  @entrypoint:restish @journey:management-realmroot-resource-server-origin
  Scenario: The built-in Realmroot Resource Server follows deployment configuration
    Given the deployment canonical origin or Realmroot scope catalog changed since the Resource Server was persisted
    When an authorized caller lists Resource Servers
    Then the built-in Realmroot Resource Server uses the current deployment API URL
    And its persisted scope registry matches the current system-managed Realmroot catalog
    When an administrator refreshes that scope registry
    Then Realmroot returns the same current catalog without fetching its own public endpoint
    And its system identifier, platform owner, and native authorization model remain immutable


  @entrypoint:restish @journey:management-restish-command-surface
  Scenario: Restish keeps routine resource operations on its generic HTTP surface
    Given Restish is connected to the unified Realmroot API
    When Restish builds its command metadata from the OpenAPI contract
    Then routine single-request operations remain discoverable from the published OpenAPI paths
    And those operations use Restish get, post, put, patch, delete, or edit instead of generated commands
    And Resource Server and Resource discovery use Restish's generic get command
    And only Agent enrollment, Agent identity, connection approval, and access approval retain generated workflow commands
    And those workflows are exposed as enroll, whoami, connect, and access
    And polling and short-lived credential issuance remain hidden behind the plugin's generic response protocols


  @entrypoint:restish @journey:management-restish-agent-auth
  Scenario: Restish transparently authenticates as an Agent
    Given Restish is connected to the unified Realmroot API
    When a new Agent invokes the generated Agent enrollment operation
    Then the Restish authentication adapter starts AgentAuth enrollment without a login command
    And the adapter uses the endpoints and issuer published by AgentAuth discovery
    And Realmroot does not provision a shared CLI OAuth application
    And the enrollment operation waits for one controller approval
    And the adapter exchanges the Agent identity assertion only at the OAuth token endpoint
    And every later command-line request uses a short-lived audience-restricted DPoP access token
    And the adapter caches validated Agent discovery metadata per Realmroot origin for a bounded lifetime
    And each token request contains only the scopes required by the selected operation and its declared polling workflow
    And every protected Realmroot operation authenticates the same Agent issuer and subject from that token
    And a configured credential override can deliberately select a non-Agent oauth2 principal
    And the approving user's identity is never used as the command-line principal
    And invoking whoami before enrollment fails without creating identity state


  @entrypoint:agent-protocol @journey:management-standard-agent-oauth
  Scenario: Realmroot authenticates Agent API requests through standard OAuth security
    Given an enrolled Agent has a locally protected signing key
    When the plugin requests Realmroot API access from the OAuth token endpoint
    Then it uses the RFC 7523 JWT bearer grant and an RFC 9449 DPoP proof
    And Realmroot issues a short-lived DPoP-bound access token restricted to the Realmroot API audience
    And the issued scopes are a subset of the Agent's automatic or controller-approved authority
    And the Agent identity assertion is never accepted directly by a Realmroot Resource API operation
    And Realmroot publishes its authorization server and DPoP requirements through standard OAuth metadata


  @entrypoint:restish @journey:management-native-device-approval
  Scenario: Native clients request OAuth device authorization codes when explicitly configured
    Given a public native application is configured with the OAuth device-code grant
    When a native client requests a device authorization code for openid profile email offline_access scopes
    Then Realmroot returns a device code, user code, verification URI, expiry, and polling interval
    And the native client can poll the OAuth token endpoint for OIDC-compatible tokens after browser approval
    And confidential, disabled, or non-native clients cannot use device authorization


  @entrypoint:restish @journey:management-restish-oauth-crud
  Scenario: An authorized Agent manages applications through the unified API
    Given the Agent has approved applications:read and applications:write scopes
    When I create, update, list, and delete an application with Restish
    Then the unified API applies each application change
    And Application authorizations form one Realm inventory whose application and status filters are optional


  @entrypoint:restish @journey:management-restish-user-crud
  Scenario: Platform administration follows the built-in Organization authority
    Given the bootstrap administrator is an Owner of the built-in platform Organization
    And no runtime authorization rule treats the administrator role as a permission bypass
    When a platform Organization member or Agent presents platform-bound users:read and users:write scopes
    Then Realm-wide user management follows those Organization scopes
    Given an Agent has direct users:read and users:write scopes bound to a User or Organization tenant
    When it attempts Realm-wide user management with Restish
    Then collection reads are tenant-filtered
    And Realm-wide user mutations are rejected


  @entrypoint:restish @journey:management-restish-organization-crud
  Scenario: Organization Agents manage only their tenant through the unified API
    Given an Agent has organizations:read and organizations:write scopes bound to one Organization
    When it lists, reads, or updates organizations with Restish
    Then the unified API exposes only that Organization
    And Organization creation requires platform Organization authority
    And Organization deletion requires authority over the owning Organization
    And Organization, member, and invitation creation return their canonical locations


  @entrypoint:restish @journey:management-restish-role-crud
  Scenario: An authorized Organization user manages dynamic Roles through the unified API
    Given the Organization membership maps Better Auth Roles to roles:read and roles:write scopes
    When I create, update, list, and delete a Role with its Resource Server scope references
    Then the unified API applies each role change
    And each role scope must exist in its business resource server protected-resource metadata
    And Role creation returns its canonical location
    And member Role replacement uses the Organization member Roles child resource
    And Agents and workloads cannot receive Organization Roles


  @entrypoint:restish @journey:management-restish-api-resource-crud
  Scenario: An authorized Agent manages Resource Servers without duplicating business authorization definitions
    Given the Agent has approved resource-servers:read and resource-servers:write scopes for the owning Organization
    When I create, update, list, and delete an API resource with Restish
    Then the unified API applies each API authorization change
    And API resource creation returns its canonical location
    And no permission catalog, scope catalog, or scope mutation operation exists
    And requestable scopes come only from each business resource server's protected-resource metadata
    And every external Resource Server is owned by the built-in platform Organization
    And an ordinary Organization cannot create, adopt, or update an external Resource Server
    And only platform Organization authority can use a platform Connector

  @entrypoint:restish @journey:management-api-resource-soft-delete
  Scenario: API resources are soft-deleted without losing authorization history
    Given the Agent has approved resource-servers:write scope
    And an API resource has authorization history
    When I delete the API resource with Restish
    Then the resource disappears from every Management and discovery interface
    And its active authorization records are revoked while history remains
    And the deletion and its actor are recorded in the Agent audit log
    And concurrent requests cannot create new active authorization for the deleted resource
    And no API can restore the resource


  @entrypoint:restish @journey:management-restish-webhook-crud
  Scenario: An authorized Agent manages webhook endpoints
    Given the Agent has approved webhooks:read and webhooks:write scopes
    When I create, update, rotate, list, and delete a webhook endpoint with Restish
    Then the unified API applies each webhook change
    And retrying a delivery request creates a new delivery attempt resource
    And every retry requires an idempotency key scoped to the delivery request
    And replaying the same key returns the same attempt without delivering twice


  @entrypoint:restish @journey:management-canonical-authority-inventory
  Scenario: Authority records keep one canonical URI across product surfaces
    Given Organization memberships and Agent access records exist for User and Organization tenants
    When a Realm operator, Organization developer, or Account Center member reads authority inventory
    Then each Organization Role, member Role collection, User Permission, Application Permission, Agent access request, and Agent Permission has one canonical API URI below its owning subject
    And filters only narrow the inventory and are never required to establish resource ownership
    And the server limits each principal to the records that principal may inspect
    And no top-level Entitlement inventory or duplicate Account Center Entitlement URI exists

  @entrypoint:restish @journey:management-tenant-owner-enforcement
  Scenario: Resource ownership is enforced consistently across the Management API
    Given User, Organization, and platform Organization resources exist
    When a Session or tenant-bound Agent lists, reads, updates, or deletes those resources
    Then required scopes and the persisted resource boundary are checked by the same authorizer
    And creating an Organization-owned Application or Resource server requires an explicit owner selector
    And an owner selector can only narrow to a tenant the caller controls
    And every persisted Organization is exposed and authorized through ordinary Organization membership
    And platform-wide operations are authorized through membership and scopes in the built-in platform Organization
    And no administrator role, principal type, or Realm authority bypasses that Organization boundary


  @entrypoint:restish @journey:management-restish-settings-update
  Scenario: An authorized Agent manages tenant settings
    Given the Agent has approved settings:read, settings:write, security:read, and security:write scopes
    When I update branding, Account Center, sign-in, Realm, Organization creation policy, Developer Console access policy, Email delivery configuration, and security resources with Restish
    Then the unified API persists each tenant setting change
    And replacing Realm, Organization creation, Developer Console access, or Email delivery state requires the current strong entity tag
