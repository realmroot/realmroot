Feature: Platform bootstrap and route access
  As a tenant operator
  I want a fresh Realmroot deployment to guide setup and protect hosted routes
  So that the first admin and authenticated entry points are created safely

  Background:
    Given the Cloudflare Worker is running in E2E mode
    And the D1 database can be reset and migrated

  @entrypoint:product-ui @journey:api-health-smoke
  Scenario: API health reports platform status
    When I request GET /api/health
    Then the response is 200
    And the body reports ok true and service "realmroot"

  @e2e @entrypoint:product-ui @journey:first-admin-gate
  Scenario: Fresh deployment routes redirect to first-admin onboarding
    Given no users exist
    When I open a hosted auth route
    Then I am redirected to /onboarding

  @e2e @entrypoint:product-ui @journey:public-onboarding
  Scenario: First admin is created from onboarding
    Given no users exist
    When I submit the onboarding form with admin profile and password details
    Then the first admin user is created
    And the page confirms that Console setup can continue from sign-in

  @e2e @entrypoint:product-ui @journey:root-signed-out-redirect
  Scenario: Root redirects signed-out visitors to hosted sign-in
    Given I am signed out
    When I open /
    Then I am redirected to /auth/sign-in

  @e2e @entrypoint:product-ui @journey:signed-out-account-redirect
  Scenario: Protected Account Center routes preserve return targets
    Given I am signed out
    When I open /profile
    Then I am redirected to /auth/sign-in
    And the return_to query parameter is /profile

  @e2e @entrypoint:product-ui @journey:root-signed-in-redirect
  Scenario: Root redirects signed-in users to Account Center
    Given I am signed in
    When I open /
    Then I am redirected to /profile
