Feature: Management API Restish entry
  As a tenant administrator
  I want Restish to authenticate and operate through the Management API contract
  So that command-line administration uses the same public API surface as integrations

  Background:
    Given a first admin exists


  @e2e @entrypoint:restish @journey:management-openapi-discovery
  Scenario: Management API contract is discoverable
    When a Management API client requests service discovery
    Then /api/management/openapi.json returns the OpenAPI 3.1 contract
    And Management API responses advertise the contract with Restish-compatible Link headers
    And Restish exposes generated Management commands


  @e2e @entrypoint:restish @journey:management-restish-oauth-auth
  Scenario: Restish authenticates to the Management API with PKCE
    Given the system-managed FlareAuth CLI OAuth client exists
    When Restish signs in through Authorization Code with PKCE
    Then the client uses client_id "flareauth-cli" without a client secret
    And the callback redirects to http://127.0.0.1:8484/callback or http://localhost:8484/callback
    And Management API requests with an administrator Bearer token are accepted
    And Management API requests with a non-admin Bearer token are rejected


  @entrypoint:restish @journey:management-native-device-approval
  Scenario: Native clients request Better Auth device approval codes when explicitly configured
    Given a public native application is configured with the Better Auth device-code grant
    When a native client requests a Better Auth device approval code for openid profile email offline_access scopes
    Then FlareAuth returns a device code, user code, verification URI, expiry, and polling interval
    And confidential, disabled, or non-native clients cannot use Better Auth device approval


  @e2e @entrypoint:restish @journey:management-restish-oauth-crud
  Scenario: Restish manages applications through the Management API
    Given I authenticate the Restish CLI through the built-in OAuth client
    When I create, update, list, and delete an application with Restish
    Then the Management API applies each application change


  @entrypoint:restish @journey:management-restish-user-crud
  Scenario: Restish manages users through the Management API
    Given I authenticate the Restish CLI through the built-in OAuth client
    When I create, update, list, and delete a user with Restish
    Then the Management API applies each user change


  @entrypoint:restish @journey:management-restish-organization-crud
  Scenario: Restish manages organizations through the Management API
    Given I authenticate the Restish CLI through the built-in OAuth client
    When I create, update, list, and delete an organization with Restish
    Then the Management API applies each organization change


  @entrypoint:restish @journey:management-restish-role-crud
  Scenario: Restish manages roles through the Management API
    Given I authenticate the Restish CLI through the built-in OAuth client
    When I create, update, list, and delete a role with Restish
    Then the Management API applies each role change


  @entrypoint:restish @journey:management-restish-api-resource-crud
  Scenario: Restish manages API resources, scopes, and permissions
    Given I authenticate the Restish CLI through the built-in OAuth client
    When I create, update, list, and delete an API resource, scope, and permission with Restish
    Then the Management API applies each API authorization change


  @entrypoint:restish @journey:management-restish-webhook-crud
  Scenario: Restish manages webhook endpoints
    Given I authenticate the Restish CLI through the built-in OAuth client
    When I create, update, rotate, list, and delete a webhook endpoint with Restish
    Then the Management API applies each webhook change


  @entrypoint:restish @journey:management-restish-settings-update
  Scenario: Restish manages tenant settings
    Given I authenticate the Restish CLI through the built-in OAuth client
    When I update branding, Account Center, sign-in, and security settings with Restish
    Then the Management API persists each tenant setting change
