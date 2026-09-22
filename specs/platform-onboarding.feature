Feature: Platform bootstrap and route access
  As a tenant operator
  I want a fresh Realmroot deployment to guide setup and protect hosted routes
  So that the first admin and authenticated entry points are created safely

  Background:
    Given the Cloudflare Worker is running in E2E mode
    And the D1 database can be reset and migrated

  @entrypoint:product-ui @journey:api-health-smoke @proof:unit
  Scenario: API health reports platform status
    When I request GET /api/health
    Then the response is 200
    And the body reports ok true and service "realmroot"

  @entrypoint:product-ui @journey:cloudflare-deployment-isolation @proof:unit
  Scenario: Canonical and fork deployments use isolated Cloudflare resources
    Given the canonical repository deploys through Cloudflare Workers Builds or a local Wrangler command
    And a deployment fork installs the supplied GitHub Actions workflow
    When either repository deploys Realmroot
    Then the canonical deployment uses the committed Wrangler configuration
    And the fork generates an ignored Wrangler configuration with its own Worker, D1, R2, Queue, and secrets
    And each deployment publishes the exact Worker artifact and Wrangler configuration produced by its build

  @entrypoint:product-ui @journey:existing-d1-upgrade @proof:unit
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
    And active native Agent Permissions without an authority Context are revoked together with their active Token Leases
    And contextful native, external, User, and Application Permissions and historical Agent access requests are preserved
    And the migrated database satisfies all foreign key constraints

  @e2e @entrypoint:product-ui @journey:first-admin-gate @proof:e2e
  Scenario: Fresh deployment routes redirect to first-admin onboarding
    Given no users exist
    When I open a hosted auth route
    Then I am redirected to /onboarding

  @e2e @entrypoint:product-ui @journey:public-onboarding @proof:e2e
  Scenario: First admin is created from onboarding
    Given no users exist
    When I submit the onboarding form with admin profile and password details
    Then the first admin user is created
    And the bootstrap admin becomes Owner of the Realmroot Platform Organization
    And the page confirms that Console setup can continue from sign-in

  @e2e @entrypoint:product-ui @journey:root-signed-out-redirect @proof:e2e
  Scenario: Root redirects signed-out visitors to hosted sign-in
    Given I am signed out
    When I open /
    Then I am redirected to /auth/sign-in

  @e2e @entrypoint:product-ui @journey:signed-out-account-redirect @proof:e2e
  Scenario: Protected Account Center routes preserve return targets
    Given I am signed out
    When I open /profile
    Then I am redirected to /auth/sign-in
    And the return_to query parameter is /profile

  @e2e @entrypoint:product-ui @journey:root-signed-in-redirect @proof:e2e
  Scenario: Root redirects signed-in users to Account Center
    Given I am signed in
    When I open /
    Then I am redirected to /profile

  @entrypoint:product-ui @journey:auth-initialization-recovery @proof:unit
  Scenario: Authentication initialization is bounded and recoverable
    Given authentication initialization requires database access
    When initialization fails or exceeds its five second deadline
    Then the request returns a service error without publishing the unfinished authentication instance
    And the next request can initialize independently
    And concurrent requests never share request-owned pending initialization I/O

  @entrypoint:product-ui @journey:worker-request-duration @proof:unit
  Scenario: Request timing includes initialization and failures
    When a request passes through Worker initialization and application routing
    Then the Worker records the complete duration and response status
    And the response exposes the complete duration through Server-Timing
    And failed initialization is included in the same measurements

  @journey:lazy-secret-derivation @entrypoint:product-ui @proof:unit
  Scenario: Requests without encrypted-secret operations avoid key derivation
    When a request constructs its dependencies without reading or writing encrypted secrets
    Then no encryption key is derived
    And the first secret operation derives one reusable key for that cipher

  @journey:worker-router-reuse @entrypoint:product-ui @proof:unit
  Scenario: Ready authentication instances reuse their HTTP router
    Given requests use the same resolved authentication configuration
    When the Worker dispatches concurrent requests
    Then the route graph is built once for that authentication instance
    And each request retains its own dependencies and correlation context
    And changed authentication configuration receives a new router
