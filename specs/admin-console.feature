Feature: Admin Console
  As a tenant administrator
  I want Console pages to manage applications, users, connectors, security, and deployment settings
  So that FlareAuth can be configured from the browser

  Background:
    Given a first admin exists
    And I am signed in to Console

  @journey:admin-dashboard
  Scenario: Admin dashboard loads tenant health
    When I open /admin
    Then the dashboard shows tenant health from real management APIs

  Scenario: Management API contract is discoverable
    When a Management API client requests service discovery
    Then /api/management/openapi.json returns the OpenAPI 3.1 contract
    And Management API responses advertise the contract with Restish-compatible Link headers

  @journey:admin-signed-out-redirect
  Scenario: Signed-out Console routes redirect before data loads
    Given I am signed out
    When I open a Console route
    Then I am redirected to admin sign-in
    And management API data requests are not made

  @journey:admin-setup-gate
  Scenario: Console setup gate handles missing OIDC applications
    Given no OIDC application exists
    When I open Console
    Then setup guidance is shown without blocking persistent Console routes

  @journey:admin-onboarding
  Scenario: Admin onboarding creates the first OIDC client
    Given no OIDC application exists
    When I complete Console onboarding
    Then the first OIDC client is created
    And integration details are visible

  @journey:admin-route-backed-navigation
  Scenario: Console navigation exposes persistent route-backed pages
    When I use Console navigation
    Then each visible product page has a canonical route
    And compatibility redirects land on persistent pages

  @journey:admin-application-inventory
  Scenario: Applications page lists OIDC clients and status controls
    Given OIDC applications exist
    When I open the applications page
    Then clients and lifecycle controls are visible

  @journey:admin-create-application
  Scenario: Applications page creates an OIDC client
    When I create an application from Console
    Then the new OIDC client appears in inventory

  @journey:admin-application-detail
  Scenario: Application detail manages lifecycle, redirects, integration details, and secret rotation
    Given an application exists
    When I open its detail page
    Then settings, branding, redirect URIs, integration details, and secret rotation are available

  @journey:admin-create-user
  Scenario: Users page creates a user
    When I create a user from Console
    Then the user is persisted through the management API

  @journey:admin-user-inventory
  Scenario: Users page supports search and status inventory
    Given users exist
    When I open the users page
    Then user search and status inventory are visible

  @journey:admin-user-detail
  Scenario: User detail updates profile, resets password, and revokes sessions
    Given a user exists
    When I open user detail
    Then profile update, password reset, and session revocation controls work

  @journey:admin-create-connector
  Scenario: Connectors page creates a draft social connector
    When I create a social connector from Console
    Then the connector is saved as a draft

  @journey:admin-connector-inventory
  Scenario: Connectors page lists email and SMS setup state
    When I open connectors
    Then Email and SMS setup state is visible

  @journey:admin-social-connector-inventory
  Scenario: Social connectors list provider settings and availability
    When I open social connector settings
    Then provider settings and availability are visible

  @journey:admin-sign-in-settings
  Scenario: Sign-in settings persist legal links and hosted auth copy
    When I update sign-in settings
    Then hosted auth uses the saved settings

  @journey:admin-sign-in-experience-routes
  Scenario: Sign-in experience tabs use canonical Console routes
    When I navigate sign-in experience tabs
    Then the browser URL uses canonical Console routes

  @journey:admin-account-center-settings
  Scenario: Account Center settings change profile visibility
    When I update Account Center settings
    Then profile visibility changes for end users

  @journey:admin-content-settings
  Scenario: Hosted content settings save through the management API
    When I update hosted copy and legal links
    Then the management API persists the content settings

  @journey:admin-security-policy
  Scenario: Security pages show policy, CAPTCHA, blocklist, and general settings
    When I open security settings
    Then MFA policy, CAPTCHA, blocklist, and general settings are visible

  @journey:admin-create-organization
  Scenario: Organizations page creates an organization
    When I create an organization
    Then it appears in authorization inventory

  @journey:admin-create-role
  Scenario: Roles page creates a role
    When I create a role
    Then it appears in authorization inventory

  @journey:admin-create-api-resource
  Scenario: API resources page creates an API resource
    When I create an API resource
    Then it appears in authorization inventory

  @journey:admin-authorization-inventory
  Scenario: Authorization inventory lists organizations, roles, and API resources
    Given authorization resources exist
    When I open the authorization pages
    Then organizations, roles, and API resources are listed

  @journey:admin-branding-settings
  Scenario: Branding settings update hosted auth
    When I update branding settings
    Then hosted auth renders the saved branding

  @journey:admin-deployment-settings
  Scenario: Deployment page shows Cloudflare runtime settings
    When I open deployment settings
    Then Cloudflare runtime configuration is visible
