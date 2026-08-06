Feature: Unified Realmroot resource API
  As an Agent operator
  I want Restish to discover every operation from one Realmroot API contract
  So that every resource has one canonical URI and explicit authorization scopes

  Background:
    Given a first admin exists


  @entrypoint:restish @journey:management-openapi-discovery
  Scenario: The unified API contract is discoverable
    When an API client requests service discovery
    Then /api/openapi.json returns the OpenAPI 3.1 contract
    And /api/docs renders interactive API documentation from that contract
    And every operation is grouped under a declared domain tag
    And API responses advertise that contract with Restish-compatible Link headers
    And the default hosted Restish profile targets https://id.realmroot.dev/api
    And Restish v2 exposes the current Agent and resource operations from the same contract
    And resources are not grouped under a management path
    And every protected operation declares its exact authorization scope through an OpenAPI security requirement
    And the contract declares only RFC 9449 DPoP and session-cookie security schemes
    And no AgentAuth, API-key, capability extension, or plugin provider name appears as a public security scheme
    And Restish can validate structured authorization detail request bodies without the root OpenAPI document


  @entrypoint:restish @journey:management-realmroot-resource-server-origin
  Scenario: The built-in Realmroot Resource Server follows deployment configuration
    Given the deployment canonical origin changed since the Resource Server was persisted
    When an authorized caller lists Resource Servers
    Then the built-in Realmroot Resource Server uses the current deployment API URL
    And its system identifier, platform owner, and native authorization model remain immutable


  @entrypoint:restish @journey:management-restish-command-surface
  Scenario: Restish keeps routine resource operations on its generic HTTP surface
    Given Restish is connected to the unified Realmroot API
    When Restish builds its command metadata from the OpenAPI contract
    Then routine single-request operations remain discoverable from the published OpenAPI paths
    And those operations use Restish get, post, put, patch, delete, or edit instead of generated commands
    And Resource Server and Resource discovery use Restish's generic get command
    And only Agent identity, connection approval, and access approval retain generated workflow commands
    And those workflows are exposed as whoami, connect, and access
    And polling and short-lived credential issuance remain hidden behind the plugin's generic response protocols


  @entrypoint:restish @journey:management-restish-agent-auth
  Scenario: Restish transparently authenticates as an Agent
    Given Restish is connected to the unified Realmroot API
    When a new Agent invokes its first protected OpenAPI operation
    Then the Restish authentication adapter starts Agent enrollment without a login command
    And the adapter uses the endpoints and issuer published by AgentAuth discovery
    And Realmroot does not provision a shared CLI OAuth application
    And the original operation waits for one controller approval
    And the adapter exchanges the Agent identity assertion only at the OAuth token endpoint
    And every later command-line request uses a short-lived audience-restricted DPoP access token
    And every protected Realmroot operation authenticates the same Agent issuer and subject from that token
    And the approving user's identity is never used as the command-line principal


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
  Scenario: Workload scopes cannot become Realm administrator permission
    Given an Agent has direct users:read and users:write scopes bound to a User or Organization tenant
    When it attempts Realm-wide user management with Restish
    Then collection reads are tenant-filtered
    And Realm-wide user mutations are rejected


  @entrypoint:restish @journey:management-restish-organization-crud
  Scenario: Organization Agents manage only their tenant through the unified API
    Given an Agent has organizations:read and organizations:write scopes bound to one Organization
    When it lists, reads, or updates organizations with Restish
    Then the unified API exposes only that Organization
    And Organization creation and deletion remain human Realm and Owner operations
    And Organization, member, and invitation creation return their canonical locations


  @entrypoint:restish @journey:management-restish-role-crud
  Scenario: An authorized Organization user manages dynamic Roles through the unified API
    Given the Organization membership maps Better Auth Roles to roles:read and roles:write scopes
    When I create, update, list, and delete a Role with its OpenAPI scope references
    Then the unified API applies each role change
    And each role scope must exist in its business resource server OpenAPI contract
    And Role creation returns its canonical location
    And member Role replacement uses the Organization member Roles child resource
    And Agents and workloads cannot receive Organization Roles


  @entrypoint:restish @journey:management-restish-api-resource-crud
  Scenario: An authorized Agent manages API resources without duplicating business authorization definitions
    Given the Agent has approved resource-servers:read and resource-servers:write scopes
    When I create, update, list, and delete an API resource with Restish
    Then the unified API applies each API authorization change
    And API resource creation returns its canonical location
    And no permission catalog, scope catalog, or scope mutation operation exists
    And requestable scopes come only from each business resource server's OpenAPI security requirements

  @entrypoint:restish @journey:management-api-resource-delete-conflict
  Scenario: API resources with authorization history cannot be permanently deleted
    Given the Agent has approved resource-servers:write scope
    And an API resource has authorization history
    When I delete the API resource with Restish
    Then the unified API returns a conflict with the blocking reference counts
    And the API resource and its authorization history remain

  @entrypoint:restish @journey:management-api-resource-archival
  Scenario: An authorized Agent archives and restores an API resource without reviving authorization
    Given the Agent has approved resource-servers:write scope
    And an enabled API resource has active connections, grants, requests, and token leases
    When I archive the API resource with Restish
    Then the resource is disabled and hidden from Agent discovery
    And its active authorization records are revoked while history remains
    And the archive and its actor are recorded in the Agent audit log
    And concurrent requests cannot create new active authorization for the archived resource
    When I restore the API resource with Restish
    Then the resource remains disabled
    And its previous authorization records remain inactive
    And the restoration is recorded in the Agent audit log


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
    Then each Organization Role, member Role collection, Agent access request, and Agent access grant has one canonical API URI
    And filters only narrow the inventory and are never required to establish resource ownership
    And the server limits each principal to the records that principal may inspect
    And Account Center does not publish duplicate Organization authority collection paths

  @entrypoint:restish @journey:management-tenant-owner-enforcement
  Scenario: Resource ownership is enforced consistently across the Management API
    Given User, Organization, and Realm resources exist
    When a Session or tenant-bound Agent lists, reads, updates, or deletes those resources
    Then required scopes and the persisted resource boundary are checked by the same authorizer
    And creating an Organization-owned Application or Resource server requires an explicit owner selector
    And an owner selector can only narrow to a tenant the caller controls
    And every persisted Organization is exposed and authorized through ordinary Organization membership


  @entrypoint:restish @journey:management-restish-settings-update
  Scenario: An authorized Agent manages tenant settings
    Given the Agent has approved settings:read, settings:write, security:read, and security:write scopes
    When I update branding, Account Center, sign-in, Realm, Organization creation policy, Developer Console access policy, Email delivery configuration, and security resources with Restish
    Then the unified API persists each tenant setting change
    And replacing Realm, Organization creation, Developer Console access, or Email delivery state requires the current strong entity tag
