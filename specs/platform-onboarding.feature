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

  @entrypoint:product-ui @journey:cloudflare-deployment-isolation
  Scenario: Canonical and fork deployments use isolated Cloudflare resources
    Given the canonical repository deploys through Cloudflare Workers Builds or a local Wrangler command
    And a deployment fork installs the supplied GitHub Actions workflow
    When either repository deploys Realmroot
    Then the canonical deployment uses the committed Wrangler configuration
    And the fork generates an ignored Wrangler configuration with its own Worker, D1, R2, Queue, and secrets
    And each deployment publishes the exact Worker artifact and Wrangler configuration produced by its build

  @entrypoint:product-ui @journey:existing-d1-upgrade
  Scenario: Existing deployments migrate to Better Auth Organization Roles
    Given an existing D1 database contains Applications, Resource servers, Better Auth memberships, and legacy custom Role records
    When the operator applies the pending production migrations
    Then the migration preserves Applications, Resource servers, and Better Auth memberships
    And the built-in platform Organization and Realmroot Resource Server use UUIDv7 identifiers with the canonical realmroot slug or identifier
    And the legacy custom Role definitions and assignments are deliberately removed without translation
    And existing Applications and Resource servers retain their real owning Organization
    And existing Applications become public and existing user-facing Applications allow the groups scope
    And Better Auth Team storage is available without creating a default Team for any Organization
    And legacy Resource server scope registries are cleared before RFC 9728 metadata replaces them
    And the migrated database satisfies all foreign key constraints

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
    And the bootstrap admin becomes Owner of the Realmroot Platform Organization
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
