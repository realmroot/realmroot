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
      When an Agent, controller, or administrator reads the Realmroot API contract
      Then the public resources are Agents, Agent enrollments, API resources, account connections, access requests, access grants, and audit events
      And Agent registrations, hosts, identity bindings, connection intents, OAuth integration records, and token leases are not public resources
      And each public resource has one canonical URI in its caller boundary

  Rule: Agent identities remain stable across hosts and credentials

    @e2e @entrypoint:agent-protocol @journey:agent-identity-enrollment
    Scenario: A new Agent establishes a stable identity on its first protected API operation
      Given a new Agent connects Restish to the Realmroot OpenAPI contract
      When the Agent invokes get-current-agent without a local Realmroot identity
      Then the transparent Restish authentication adapter registers locally generated host and Agent keys
      And get-current-agent waits while an authorized controller approves the Agent once from the hosted verification page
      And the adapter creates a personal stable identity through the approved Agent session
      Then Realmroot creates an Agent with a stable issuer and subject
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
      When the Agent invokes any operation discovered from the Realmroot OpenAPI contract
      Then Realmroot authenticates the request as that Agent identity
      And Realmroot never substitutes the approving user's identity for the Agent
      And the controller's browser session is used only to approve enrollment or authority

    @entrypoint:restish @journey:agent-runtime-identity-continuity
    Scenario: Restish API aliases and sessions reuse the runtime Agent identity
      Given the plugin detects the current Agent runtime or reads an explicit runtime declaration
      And one Realmroot issuer is connected through multiple Restish API names or profiles
      When the Agent invokes Realmroot operations across those connections and later runtime sessions
      Then the plugin reuses one host registration and stable Agent issuer and subject for that runtime
      And Restish API names, profiles, and runtime session identifiers do not create another Agent identity
      And another runtime uses a separately secured local identity
      And another Realmroot issuer uses a separately secured local identity
      And an explicitly supplied AGENT runtime selects that runtime identity instead of the detected runtime

    @e2e @entrypoint:restish @journey:agent-management-authority
    Scenario: An Agent gains resource access without changing identity
      Given an Agent identity has only its default self-service authority
      When the Agent invokes an operation that requires a Realmroot resource scope
      Then Realmroot rejects the operation and identifies the missing authority
      When the Agent requests the missing management authority
      Then Realmroot records the request through the existing AgentAuth capability approval flow
      And Realmroot returns the existing hosted Agent approval URL for that request
      And the Restish adapter opens the hosted approval URL in the controller's browser
      And the capability request command waits for the approval decision
      When an authorized controller reviews and approves the request
      Then the existing approval request activates the management capability grant
      And the hosted approval page replaces the request with a clear completion state that says it can be closed
      And the capability request command completes with the active grants
      And the same Agent identity can invoke only operations covered by the approved resource scopes
      And assigned resource roles optionally restrict which OpenAPI scopes the Agent can request
      And Restish does not automatically replay the previously denied operation
      And the Agent does not log in again or adopt the controller's identity

    @entrypoint:restish @journey:agent-capability-approval-renewal
    Scenario: Repeating or renewing a capability request always returns a usable approval
      Given an Agent has pending management capability grants
      When the Agent repeats the capability request before its approval expires
      Then Realmroot expires the previous approval and returns a new hosted approval URL
      And Realmroot reuses the pending grants without creating duplicates
      When the new approval expires and the Agent repeats the capability request
      Then Realmroot returns another new hosted approval URL without an internal error

    @e2e @entrypoint:product-ui @journey:agent-capability-denial
    Scenario: A controller can deny Agent enrollment or requested capabilities
      Given an Agent login or capability request is pending
      When the authorized controller denies the request
      Then Realmroot resolves the existing AgentAuth approval as denied
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
      Given Realmroot is reached through a non-canonical request origin
      When a controller approves an Agent enrollment
      Then the Agent issuer is the Better Auth OIDC issuer
      And preview or request origins do not change the Agent issuer and subject
      And hosted Agent approval URLs use the configured deployment origin
      And Realmroot does not publish a second Agent-only OIDC issuer

  Rule: Native API resources use the shared Agent access workflow

    @entrypoint:product-ui @journey:native-api-resource-registration
    Scenario: An administrator registers a native API that trusts Realmroot
      Given a product uses Realmroot as its OIDC provider and OAuth authorization server
      When an administrator creates an API resource with native authorization mode
      Then the administrator configures only its audience and protected resource URL
      And no external authorization server, OAuth client, or account connection is configured
      And the product API validates Realmroot access tokens with the published issuer and JWKS
      And the protected resource advertises its OpenAPI contract with a standard service-desc link
      And Realmroot derives every requestable scope from the OpenAPI security requirements
      And Realmroot does not store or administer a separate scope catalog

    @entrypoint:agent-protocol @journey:native-api-resource-access-request
    Scenario: An Agent requests access to a native API
      Given an enabled native API resource belongs to the Agent's home space
      When the Agent lists available resources
      Then Realmroot returns that resource and its protected resource URL without requiring an account connection
      When Restish reads the target OpenAPI operation and the Agent requests its exact scope set
      Then Realmroot validates that scope set against the current target OpenAPI contract
      And assigned resource roles make every requested scope eligible when the Agent has such roles
      And the absence of a resource role does not block the request
      And Realmroot creates the same pending access-request resource used for external APIs
      And it does not require a user-created authority grant or grant identifier
      When an authorized controller approves the request
      Then Realmroot creates the same access-grant resource used for external APIs

    @entrypoint:agent-protocol @journey:agent-resource-discovery-isolation
    Scenario: An unavailable API resource does not block resource discovery
      Given multiple enabled API resources are visible to an Agent
      And one resource cannot publish its current OpenAPI contract
      When the Agent lists available resources
      Then Realmroot returns the resource with unavailable status and no requestable scopes
      And returns every available resource with available status and its current requestable scopes

    @entrypoint:agent-protocol @journey:agent-resource-access-without-role
    Scenario: An Agent requests resource access without a role
      Given an enabled API resource publishes the requested scope in its OpenAPI contract
      And the Agent has no assigned role for that resource
      When the Agent requests that exact scope
      Then Realmroot allows the access request to proceed to controller approval
      And an approved native token carries an empty roles claim

    @e2e @entrypoint:agent-protocol @journey:native-api-resource-token
    Scenario: An Agent calls a native API directly
      Given a controller approved an exact native API resource request
      When Restish requests a token from the Agent's access grant
      Then the Realmroot plugin creates and retains a separate DPoP key
      And the plugin sends the DPoP proof in the standard DPoP header
      Then Realmroot issues a short-lived audience-bound JWT access token
      And the token uses the Better Auth issuer and signing keys
      And the token identifies the controller as subject and the Agent and host in the RFC 8693 actor chain
      And the token carries only the approved scopes
      And groups identifies the Agent's organization home space
      And roles identifies the Agent's effective roles for that API resource
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
      Then Realmroot denies the request
      And the Agent cannot substitute another account connection or resource
      When an active access grant permits the request
      Then the token issuer is selected only from the API resource authorization mode
      And one-time, limited, persistent, revocation, and audit behavior is consistent across both modes

    @entrypoint:restish @journey:restish-resource-credential-lifecycle
    Scenario: Restish replaces obsolete local resource credentials
      Given Restish stores a DPoP credential for an Agent API resource
      When the controller approves a new access grant for the same resource
      Then the plugin replaces the old local grant binding with the new grant
      And target requests use only the new DPoP credential
      When a one-time token expires or Realmroot rejects an inactive grant
      Then the plugin removes that local resource credential
      And the Agent must request a new access grant

  Rule: Workload token exchange preserves authorization boundaries

    @entrypoint:agent-protocol @journey:workload-token-exchange-claims
    Scenario: Introspection reports only authorization-server controlled security claims
      Given a trusted workload assertion contains untrusted private claims
      When Realmroot exchanges and introspects its opaque access token
      Then issuer, audience, client, scope, activity, token type, and lifetime come only from Realmroot
      And subject assertion claims cannot override introspection security fields
      And only the confidential client that owns the exchange can introspect the token

    @entrypoint:agent-protocol @journey:workload-refresh-security
    Scenario: Token-exchange refresh tokens are confidential, rotating, and revocable
      Given a confidential client received a token-exchange refresh token
      When it refreshes with valid client authentication and an enabled federated credential
      Then Realmroot rotates the refresh token and invalidates the previous value
      When the old token is replayed or the federated credential is disabled or deleted
      Then Realmroot rejects the refresh with invalid_grant
      And disabling the client or rotating its secret also prevents refresh

  Rule: External API resources use target-issued authorization

    @entrypoint:product-ui @journey:external-api-resource-registration
    Scenario: An administrator registers an external API resource by protocol
      Given a target resource publishes protected-resource and authorization-server metadata
      When an administrator creates an external API resource from its resource URL
      Then Realmroot discovers its issuer, OAuth endpoints, token exchange, DPoP, and revocation
      And the resource URL advertises its OpenAPI contract with a standard service-desc link
      And Realmroot derives every requestable scope only from that OpenAPI contract
      And authorization-server scopes_supported is not a scope catalog
      And Realmroot registers or uses an explicitly configured OAuth client
      And the resource cannot be enabled for Agents when a required capability is absent
      And no identity Connector or HTTP proxy configuration is created

    @entrypoint:restish @journey:external-api-resource-reconfiguration
    Scenario: Changing an external API resource URL reconfigures its protocol boundary
      Given an external API resource has active authorization-server metadata and OAuth client configuration
      When an administrator changes its resource URL
      Then the same request must provide replacement authorization configuration
      And Realmroot rediscovers the target metadata before enabling the changed resource

    @entrypoint:restish @journey:external-api-resource-canonical-callback
    Scenario: External OAuth registration uses the deployment's canonical callback
      Given Realmroot is reached through a non-canonical request origin
      When an administrator dynamically registers an external API resource
      Then the OAuth redirect URI and JWKS URI use the configured deployment origin
      And a later Account Center authorization request uses that same redirect URI

    @e2e @entrypoint:agent-protocol @journey:external-resource-first-access
    Scenario: An Agent requests first access to an external API resource
      Given an enabled external API resource has active authorization configuration
      And the Agent's home space has no account connection for that resource
      When the Agent discovers the resource and requests exact OpenAPI scopes
      Then Realmroot creates a pending access request without requiring a connection
      When the controller opens the approval page
      Then the controller can select an existing account or connect a new account with the exact requested scopes
      And OAuth returns the controller to the same approval
      When the controller binds the account connection and approves the request
      Then Realmroot records a resource account connection owned by the Agent's home space
      And stores its refresh credential encrypted
      And never exposes the refresh credential through an API, audit event, or error
      And binds that connection to the request and grant
      And the Agent can obtain a DPoP-bound target access token

    @entrypoint:agent-protocol @journey:agent-resource-discovery
    Scenario: An Agent discovers accounts and requests exact resource authority
      Given enabled native and externally authorized API resources exist
      When the Agent lists available resources
      Then Realmroot returns enabled resources even when an external resource has no connected account
      And returns protected resource URLs, redacted accounts, and active grants
      When Restish reads a target OpenAPI operation and the Agent requests an account and its exact scope set without an applicable grant
      Then Realmroot validates that scope set against the current target OpenAPI contract
      And assigned resource roles restrict the request when present
      And the connected account permits every requested scope
      Then Realmroot creates one pending access request and returns a hosted approval URL
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
      Then Realmroot returns to the same approval without exposing its token to the server callback URL
      And the controller can approve or deny the request

    @e2e @entrypoint:agent-protocol @journey:agent-direct-resource-access
    Scenario: An Agent calls an external API directly with a target-issued token
      Given a controller approved an exact external API resource request
      When Restish requests a token from the Agent's access grant
      Then the Realmroot plugin creates and retains a separate DPoP key
      And the plugin sends a standard DPoP header bound to the target token endpoint
      Then Realmroot submits a signed Agent assertion with the RFC 7523 JWT bearer grant
      And the target platform issues an Agent access token
      And Realmroot exchanges the connected user's subject token and the target-issued Agent access token with RFC 8693
      And the target platform issues a short-lived DPoP-bound access token
      And the token identifies the target user as subject and the Agent in the RFC 8693 actor claim
      And no Realmroot-specific metadata, grant type, token type, or claim is required
      And Realmroot returns no refresh token
      And Restish stores but does not print the raw access token
      When the Agent connects Restish to the discovered protected resource URL
      Then Restish discovers the target OpenAPI contract from its standard service-desc link
      When the Agent invokes a generated target operation
      Then the plugin sends the access token and a fresh DPoP proof directly to the target platform
      And no Realmroot egress or credential injection endpoint exists

    @e2e @entrypoint:agent-protocol @journey:agent-resource-revocation
    Scenario: Revocation stops direct external API access
      Given an Agent has an active target token
      When a controller revokes its grant, account connection, credential, or Agent
      Then Realmroot calls the target revocation endpoint for active target tokens
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
      When Realmroot allows or denies the request
      Then the audit record identifies the controller authority, resource account, Agent, host, grant, scopes, and result
      And it excludes credentials, authorization headers, and complete request or response bodies
