Feature: Agent identity and external API authorization
  As an Agent controller
  I want Agents to have durable identities and request constrained access to connected API resources
  So that Agents can act independently or by delegation without receiving refresh tokens

  Background:
    Given a first admin exists
    And Agent identity is enabled for the tenant

  Rule: Public APIs expose product resources rather than security implementation records

    @entrypoint:agent-protocol @journey:agent-public-resource-model
    Scenario: API clients manage stable product aggregates
      Given Agent identity uses protocol registrations, host credentials, and identity bindings internally
      And external authorization uses discovery metadata, OAuth clients, connection state, and token leases internally
      When an Agent, controller, or administrator reads the FlareAuth API contract
      Then the public resources are Agents, Agent enrollments, API resources, account connections, access requests, access grants, and audit events
      And Agent registrations, hosts, identity bindings, connection intents, OAuth integration records, and token leases are not public resources
      And each public resource has one canonical URI in its caller boundary

  Rule: Agent identities remain stable across hosts and credentials

    @e2e @entrypoint:agent-protocol @journey:agent-identity-enrollment
    Scenario: A new Agent establishes a stable identity on its first protected API operation
      Given a new Agent connects Restish to the FlareAuth OpenAPI contract
      When the Agent invokes get-current-agent without a local FlareAuth identity
      Then the transparent Restish authentication adapter registers locally generated host and Agent keys
      And get-current-agent waits while an authorized controller approves the Agent once from the hosted verification page
      And the adapter creates a personal stable identity through the approved Agent session
      Then FlareAuth creates an Agent with a stable issuer and subject
      And the Agent belongs to exactly one home space
      And users govern the Agent through roles in that space
      And the host registration is bound to that Agent identity
      And the original get-current-agent operation resumes and returns the stable issuer and subject
      And the hosted approval page replaces the request with a clear completion state that says it can be closed
      And later OpenAPI operations reuse the Agent identity without another login command
      And enrollment alone grants no management or external API resource access
      And an unbound protocol registration cannot exercise Agent identity capabilities

    @entrypoint:restish @journey:agent-single-cli-principal
    Scenario: Command-line operations always use the Agent principal
      Given an Agent has established a stable identity in Restish
      When the Agent invokes any operation discovered from the FlareAuth OpenAPI contract
      Then FlareAuth authenticates the request as that Agent identity
      And FlareAuth never substitutes the approving user's identity for the Agent
      And the controller's browser session is used only to approve enrollment or authority

    @e2e @entrypoint:restish @journey:agent-management-authority
    Scenario: An Agent gains management access without changing identity
      Given an Agent identity has only its default self-service authority
      When the Agent invokes an operation that requires tenant management authority
      Then FlareAuth rejects the operation and identifies the missing authority
      When the Agent requests the missing management authority
      Then FlareAuth records the request through the existing AgentAuth capability approval flow
      And FlareAuth returns the existing hosted Agent approval URL for that request
      And the Restish adapter opens the hosted approval URL in the controller's browser
      And the capability request command waits for the approval decision
      When an authorized controller reviews and approves the request
      Then the existing approval request activates the management capability grant
      And the hosted approval page replaces the request with a clear completion state that says it can be closed
      And the capability request command completes with the active grants
      And the same Agent identity can invoke the operation
      And Restish does not automatically replay the previously denied operation
      And the Agent does not log in again or adopt the controller's identity

    @entrypoint:restish @journey:agent-capability-approval-renewal
    Scenario: Repeating or renewing a capability request always returns a usable approval
      Given an Agent has pending management capability grants
      When the Agent repeats the capability request before its approval expires
      Then FlareAuth expires the previous approval and returns a new hosted approval URL
      And FlareAuth reuses the pending grants without creating duplicates
      When the new approval expires and the Agent repeats the capability request
      Then FlareAuth returns another new hosted approval URL without an internal error

    @e2e @entrypoint:product-ui @journey:agent-capability-denial
    Scenario: A controller can deny Agent enrollment or requested capabilities
      Given an Agent login or capability request is pending
      When the authorized controller denies the request
      Then FlareAuth resolves the existing AgentAuth approval as denied
      And the hosted approval page clearly says the request was denied and can be closed
      And the waiting Restish command exits without receiving the requested authority

    @entrypoint:agent-protocol @journey:agent-multi-host-continuity
    Scenario: One Agent identity can be used from independently secured hosts
      Given an Agent identity has an active host registration
      When a controller enrolls the same Agent on another host with a different public key
      Then both host registrations resolve to the same Agent issuer and subject
      And neither host receives the other host's private key

    @entrypoint:agent-protocol @journey:agent-host-revocation
    Scenario: Revoking one host does not revoke the Agent identity
      Given an Agent identity has two active host registrations
      When a controller revokes one host
      Then that host can no longer authenticate as the Agent
      And the other host and the Agent identity remain active

    @entrypoint:product-ui @journey:agent-identity-recovery
    Scenario: A controller recovers an Agent without changing its subject
      Given an Agent's host credentials may be compromised
      When an authorized controller recovers the Agent
      Then every existing host credential and session is revoked
      And external API resource grants are frozen
      And the Agent keeps the same issuer and subject

    @entrypoint:product-ui @journey:agent-identity-retirement
    Scenario: A retired Agent subject is never reassigned
      Given an Agent has a stable issuer and subject
      When an authorized controller permanently retires the Agent
      Then the Agent can no longer authenticate or receive grants
      And its subject remains reserved for historical audit records

    @entrypoint:agent-protocol @journey:agent-stable-issuer
    Scenario: Agent identity uses the deployment's existing OIDC issuer
      Given FlareAuth is reached through a non-canonical request origin
      When a controller approves an Agent enrollment
      Then the Agent issuer is the Better Auth OIDC issuer
      And preview or request origins do not change the Agent issuer and subject
      And hosted Agent approval URLs use the configured deployment origin
      And FlareAuth does not publish a second Agent-only OIDC issuer

  Rule: Native API resources use the shared Agent access workflow

    @entrypoint:product-ui @journey:native-api-resource-registration
    Scenario: An administrator registers a native API that trusts FlareAuth
      Given a product uses FlareAuth as its OIDC provider and OAuth authorization server
      When an administrator creates an API resource with native authorization mode
      Then the administrator configures its audience, protected resource URL, and requestable scopes
      And no external authorization server, OAuth client, or account connection is configured
      And the product API validates FlareAuth access tokens with the published issuer and JWKS
      And the protected resource advertises its OpenAPI contract with a standard service-desc link

    @entrypoint:agent-protocol @journey:native-api-resource-access-request
    Scenario: An Agent requests access to a native API
      Given an enabled native API resource belongs to the Agent's home space
      When the Agent lists available resources
      Then FlareAuth returns that resource, its protected resource URL, and its requestable scopes without requiring an account connection
      When the Agent requests an exact scope set
      Then FlareAuth creates the same pending access-request resource used for external APIs
      And it does not require a user-created authority grant or grant identifier
      When an authorized controller approves the request
      Then FlareAuth creates the same access-grant resource used for external APIs

    @e2e @entrypoint:agent-protocol @journey:native-api-resource-token
    Scenario: An Agent calls a native API directly
      Given a controller approved an exact native API resource request
      When Restish requests a token from the Agent's access grant
      Then the FlareAuth plugin creates and retains a separate DPoP key
      And the plugin sends the DPoP proof in the standard DPoP header
      Then FlareAuth issues a short-lived audience-bound JWT access token
      And the token uses the Better Auth issuer and signing keys
      And the token identifies the controller as subject and the Agent and host in the RFC 8693 actor chain
      And the token carries only the approved scopes
      And the token is bound to the Agent's DPoP key
      And Restish stores but does not print the raw access token
      When the Agent connects Restish to the discovered protected resource URL
      Then Restish discovers the target OpenAPI contract from its standard service-desc link
      When the Agent invokes a generated target operation
      Then the plugin sends the access token and a fresh DPoP proof directly to the product API
      And the product API validates the token type, signature, issuer, audience, expiry, scopes, and DPoP binding

    @entrypoint:agent-protocol @journey:agent-resource-grant-policy
    Scenario: Both API authorization modes enforce the same access grant
      Given an Agent requests a target token for an API resource
      When no active access grant permits the Agent, resource, scopes, and lifetime
      Then FlareAuth denies the request
      And the Agent cannot substitute another account connection or resource
      When an active access grant permits the request
      Then the token issuer is selected only from the API resource authorization mode
      And one-time, limited, persistent, revocation, and audit behavior is consistent across both modes

  Rule: Workload token exchange preserves authorization boundaries

    @entrypoint:agent-protocol @journey:workload-token-exchange-claims
    Scenario: Introspection reports only authorization-server controlled security claims
      Given a trusted workload assertion contains untrusted private claims
      When FlareAuth exchanges and introspects its opaque access token
      Then issuer, audience, client, scope, activity, token type, and lifetime come only from FlareAuth
      And subject assertion claims cannot override introspection security fields
      And only the confidential client that owns the exchange can introspect the token

    @entrypoint:agent-protocol @journey:workload-refresh-security
    Scenario: Token-exchange refresh tokens are confidential, rotating, and revocable
      Given a confidential client received a token-exchange refresh token
      When it refreshes with valid client authentication and an enabled federated credential
      Then FlareAuth rotates the refresh token and invalidates the previous value
      When the old token is replayed or the federated credential is disabled or deleted
      Then FlareAuth rejects the refresh with invalid_grant
      And disabling the client or rotating its secret also prevents refresh

  Rule: External API resources use target-issued authorization

    @entrypoint:product-ui @journey:external-api-resource-registration
    Scenario: An administrator registers an external API resource by protocol
      Given a target resource publishes protected-resource and authorization-server metadata
      When an administrator creates an external API resource from its resource URL
      Then FlareAuth discovers its issuer, OAuth endpoints, supported scopes, token exchange, DPoP, and revocation
      And the resource URL advertises its OpenAPI contract with a standard service-desc link
      And FlareAuth registers or uses an explicitly configured OAuth client
      And the resource cannot be enabled for Agents when a required capability is absent
      And no identity Connector or HTTP proxy configuration is created

    @entrypoint:restish @journey:external-api-resource-reconfiguration
    Scenario: Changing an external API resource URL reconfigures its protocol boundary
      Given an external API resource has active authorization-server metadata and OAuth client configuration
      When an administrator changes its resource URL
      Then the same request must provide replacement authorization configuration
      And FlareAuth rediscovers the target metadata before enabling the changed resource

    @entrypoint:restish @journey:external-api-resource-canonical-callback
    Scenario: External OAuth registration uses the deployment's canonical callback
      Given FlareAuth is reached through a non-canonical request origin
      When an administrator dynamically registers an external API resource
      Then the OAuth redirect URI and JWKS URI use the configured deployment origin
      And a later Account Center authorization request uses that same redirect URI

    @e2e @entrypoint:product-ui @journey:resource-account-connection
    Scenario: A user connects an account to an external API resource
      Given an external API resource is enabled
      When a user completes authorization code with PKCE in Account Center
      Then FlareAuth records a resource account connection owned by the user's home space
      And stores its refresh credential encrypted
      And never exposes the refresh credential through an API, audit event, or error
      And connecting the account grants no Agent permission

    @entrypoint:agent-protocol @journey:agent-resource-discovery
    Scenario: An Agent discovers accounts and requests exact resource authority
      Given connected resource accounts exist in the Agent's home space
      When the Agent lists available resources
      Then FlareAuth returns enabled resources, protected resource URLs, requestable scopes, redacted accounts, and active grants
      When the Agent requests an account and exact scope set without an applicable grant
      Then FlareAuth creates one pending access request and returns a hosted approval URL
      And it does not require a pre-existing Agent resource grant

    @entrypoint:product-ui @journey:agent-resource-approval
    Scenario: A controller decides an Agent resource request in one step
      Given an Agent resource access request is pending
      When an authorized controller approves it
      Then the controller confirms the resource account, exact scopes, and one-time, limited, or persistent mode
      And scope expansion, another account, or another resource requires a new approval
      And a denied request cannot issue a target token

    @e2e @entrypoint:product-ui @journey:agent-resource-approval-sign-in
    Scenario: A signed-out controller signs in without losing the Agent approval
      Given an Agent resource access request is pending
      And the controller is signed out
      When the Restish plugin opens the hosted approval URL
      And the controller signs in
      Then FlareAuth returns to the same approval without exposing its token to the server callback URL
      And the controller can approve or deny the request

    @e2e @entrypoint:agent-protocol @journey:agent-direct-resource-access
    Scenario: An Agent calls an external API directly with a target-issued token
      Given a controller approved an exact external API resource request
      When Restish requests a token from the Agent's access grant
      Then the FlareAuth plugin creates and retains a separate DPoP key
      And the plugin sends a standard DPoP header bound to the target token endpoint
      Then FlareAuth submits a signed Agent assertion with the RFC 7523 JWT bearer grant
      And the target platform issues an Agent access token
      And FlareAuth exchanges the connected user's subject token and the target-issued Agent access token with RFC 8693
      And the target platform issues a short-lived DPoP-bound access token
      And the token identifies the target user as subject and the Agent in the RFC 8693 actor claim
      And no FlareAuth-specific metadata, grant type, token type, or claim is required
      And FlareAuth returns no refresh token
      And Restish stores but does not print the raw access token
      When the Agent connects Restish to the discovered protected resource URL
      Then Restish discovers the target OpenAPI contract from its standard service-desc link
      When the Agent invokes a generated target operation
      Then the plugin sends the access token and a fresh DPoP proof directly to the target platform
      And no FlareAuth egress or credential injection endpoint exists

    @e2e @entrypoint:agent-protocol @journey:agent-resource-revocation
    Scenario: Revocation stops direct external API access
      Given an Agent has an active target token
      When a controller revokes its grant, account connection, credential, or Agent
      Then FlareAuth calls the target revocation endpoint for active target tokens
      And subsequent token requests are rejected
      And unrelated Agents, accounts, and grants remain active

  Rule: Controllers and administrators can govern Agent activity

    @entrypoint:product-ui @journey:agent-governance-surfaces
    Scenario: Agent management follows ownership and platform boundaries
      Given personal and organization-owned Agents exist
      When an authorized controller opens Agent management
      Then Account Center presents personal Agents
      And organization settings present organization-owned Agents
      And Console presents tenant inventory, audit, and emergency revocation

    @entrypoint:product-ui @journey:agent-audit-chain
    Scenario: Audit records reconstruct an Agent authorization decision
      Given an Agent host attempts to request external API resource authority
      When FlareAuth allows or denies the request
      Then the audit record identifies the controller authority, resource account, Agent, host, grant, scopes, and result
      And it excludes credentials, authorization headers, and complete request or response bodies
