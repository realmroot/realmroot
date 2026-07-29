Feature: Agent identity and external API authorization
  As an Agent controller
  I want Agents to have durable identities and request constrained access to connected API resources
  So that Agents can act independently or by delegation without receiving refresh tokens

  Background:
    Given a first admin exists
    And Agent identity is enabled for the tenant

  Rule: Agent identities remain stable across hosts and credentials

    @e2e @entrypoint:agent-protocol @journey:agent-identity-enrollment
    Scenario: A new Agent establishes a stable identity on its first protected API operation
      Given a new Agent connects Restish to the FlareAuth OpenAPI contract
      When the Agent invokes whoami without a local FlareAuth identity
      Then the transparent Restish authentication adapter registers locally generated host and Agent keys
      And whoami waits while an authorized controller approves the Agent once from the hosted verification page
      And the adapter creates a personal stable identity through the approved Agent session
      Then FlareAuth creates an Agent with a stable issuer and subject
      And the Agent belongs to exactly one home space
      And users govern the Agent through roles in that space
      And the host registration is bound to that Agent identity
      And the original whoami operation resumes and returns the stable issuer and subject
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
      And FlareAuth does not publish a second Agent-only OIDC issuer

  Rule: Tokens distinguish an Agent's identity from delegated authority

    @entrypoint:agent-protocol @journey:agent-autonomous-authority
    Scenario: An Agent can receive a token for its own authority
      Given an active Agent host proves possession of its registered key
      When it requests a token from the Better Auth OAuth token endpoint for the Agent's own resources
      Then FlareAuth issues a short-lived audience-bound token
      And the token uses the Better Auth issuer and signing keys
      And the token identifies the Agent as subject and the host as actor
      And the token carries only explicitly granted scopes

    @entrypoint:agent-protocol @journey:agent-delegated-authority
    Scenario: An Agent can receive explicitly delegated authority
      Given a user or organization granted authority to an Agent
      When an active Agent host requests a token from the Better Auth OAuth token endpoint for that authority
      Then the token identifies the user or organization as subject
      And the token identifies the host and Agent through the RFC 8693 nested actor chain
      And the token is limited by the delegation's scopes, constraints, and expiry

    @entrypoint:agent-protocol @journey:agent-oidc-federation
    Scenario: An OAuth resource server can associate an account with an Agent
      Given a resource server trusts the FlareAuth issuer and signing keys
      When it validates an audience-bound JWT access token for an Agent
      Then it validates the access-token type, signature, issuer, audience, and expiry
      And it associates the account by issuer and subject
      And an Agent-aware resource server can distinguish the Agent subject and acting host
      And the resource server never needs the Agent's long-lived public key as its account identifier
      And this access-token profile does not claim to be an Agent OIDC login flow

    @entrypoint:agent-protocol @journey:agent-grant-policy
    Scenario: Agent authority is denied unless an applicable grant allows it
      Given an Agent host requests authority for a resource
      When no active grant permits the scope, resource, host, time, and usage constraints
      Then FlareAuth denies the request
      When an applicable grant permits the request but requires step-up approval
      Then FlareAuth waits for an authorized controller to approve the high-risk use
      And the approval is bound to the exact requested scopes, audience, grant, and host binding
      And the approved request cannot be retried with broader authority

    @entrypoint:agent-protocol @journey:agent-oauth-errors
    Scenario: Agent token failures use OAuth and DPoP error contracts
      Given an Agent requests or presents a DPoP-bound authority token
      When its OAuth request, DPoP proof, or access token is invalid
      Then the token endpoint returns a standard OAuth error response
      And an invalid DPoP proof returns invalid_dpop_proof
      And a protected resource returns a DPoP WWW-Authenticate challenge
      And a step-up requirement returns structured approval details rather than an identifier embedded in prose

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
      And FlareAuth registers or uses an explicitly configured OAuth client
      And the resource cannot be enabled for Agents when a required capability is absent
      And no identity Connector or HTTP proxy configuration is created

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
      Then FlareAuth returns enabled resources, requestable scopes, redacted accounts, and active grants
      When the Agent requests an account and exact scope set without an applicable grant
      Then FlareAuth creates one pending access request and returns a hosted approval URL
      And it does not require a pre-existing Agent resource grant

    @entrypoint:product-ui @journey:agent-resource-approval
    Scenario: A controller decides an Agent resource request in one step
      Given an Agent resource access request is pending
      When an authorized controller approves it
      Then the controller confirms the resource account, exact scopes, and one-time, limited, or persistent mode
      And scope expansion, another account, or another resource requires a new approval
      And a denied request cannot issue a token lease

    @e2e @entrypoint:agent-protocol @journey:agent-direct-resource-access
    Scenario: An Agent calls an external API directly with a target-issued token
      Given a controller approved an exact external API resource request
      When the Agent requests a token lease with a DPoP proof for the target token endpoint
      Then FlareAuth submits a signed Agent assertion with the RFC 7523 JWT bearer grant
      And the target platform issues an Agent access token
      And FlareAuth exchanges the connected user's subject token and the target-issued Agent access token with RFC 8693
      And the target platform issues a short-lived DPoP-bound access token
      And the token identifies the target user as subject and the Agent in the RFC 8693 actor claim
      And no FlareAuth-specific metadata, grant type, token type, or claim is required
      And FlareAuth returns no refresh token
      When the Agent calls the target API
      Then the Agent sends the request directly to the target platform
      And no FlareAuth egress or credential injection endpoint exists

    @e2e @entrypoint:agent-protocol @journey:agent-resource-revocation
    Scenario: Revocation stops direct external API access
      Given an Agent has an active external token lease
      When a controller revokes its grant, resource account, host, or Agent
      Then FlareAuth calls the target revocation endpoint for active leases
      And subsequent lease requests are rejected
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
