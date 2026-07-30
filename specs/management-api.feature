Feature: Unified Realmroot API Restish entry
  As an Agent operator
  I want Restish to discover every operation from one Realmroot API contract
  So that identity and permissions, rather than separate API surfaces, determine what an Agent can do

  Background:
    Given a first admin exists


  @entrypoint:restish @journey:management-openapi-discovery
  Scenario: The unified API contract is discoverable
    When an API client requests service discovery
    Then /api/openapi.json returns the OpenAPI 3.1 contract
    And API responses advertise that contract with Restish-compatible Link headers
    And Restish v2 exposes the current Agent and resource operations from the same contract


  @entrypoint:restish @journey:management-restish-agent-auth
  Scenario: Restish transparently authenticates as an Agent
    Given Restish is connected to the unified Realmroot API
    When a new Agent invokes its first protected OpenAPI operation
    Then the Restish authentication adapter starts Agent enrollment without a login command
    And the adapter uses the endpoints and issuer published by AgentAuth discovery
    And Realmroot does not provision a shared CLI OAuth application
    And the original operation waits for one controller approval
    And every later command-line request is authenticated as the same Agent issuer and subject
    And the approving user's identity is never used as the command-line principal


  @entrypoint:restish @journey:management-native-device-approval
  Scenario: Native clients request OAuth device authorization codes when explicitly configured
    Given a public native application is configured with the OAuth device-code grant
    When a native client requests a device authorization code for openid profile email offline_access scopes
    Then Realmroot returns a device code, user code, verification URI, expiry, and polling interval
    And the native client can poll the OAuth token endpoint for OIDC-compatible tokens after browser approval
    And confidential, disabled, or non-native clients cannot use device authorization


  @entrypoint:restish @journey:management-restish-oauth-crud
  Scenario: An authorized Agent manages applications through the unified API
    Given the Agent has approved tenant management authority
    When I create, update, list, and delete an application with Restish
    Then the unified API applies each application change


  @entrypoint:restish @journey:management-restish-user-crud
  Scenario: An authorized Agent manages users through the unified API
    Given the Agent has approved tenant management authority
    When I create, update, list, and delete a user with Restish
    Then the unified API applies each user change


  @entrypoint:restish @journey:management-restish-organization-crud
  Scenario: An authorized Agent manages organizations through the unified API
    Given the Agent has approved tenant management authority
    When I create, update, list, and delete an organization with Restish
    Then the unified API applies each organization change


  @entrypoint:restish @journey:management-restish-role-crud
  Scenario: An authorized Agent manages roles through the unified API
    Given the Agent has approved tenant management authority
    When I create, update, list, and delete a role with Restish
    Then the unified API applies each role change


  @entrypoint:restish @journey:management-restish-api-resource-crud
  Scenario: An authorized Agent manages API resources, scopes, and permissions
    Given the Agent has approved tenant management authority
    When I create, update, list, and delete an API resource, scope, and permission with Restish
    Then the unified API applies each API authorization change


  @entrypoint:restish @journey:management-restish-webhook-crud
  Scenario: An authorized Agent manages webhook endpoints
    Given the Agent has approved tenant management authority
    When I create, update, rotate, list, and delete a webhook endpoint with Restish
    Then the unified API applies each webhook change


  @entrypoint:restish @journey:management-restish-settings-update
  Scenario: An authorized Agent manages tenant settings
    Given the Agent has approved tenant management authority
    When I update branding, Account Center, sign-in, and security settings with Restish
    Then the unified API persists each tenant setting change
