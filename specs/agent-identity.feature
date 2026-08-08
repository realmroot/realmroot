Feature: Agent identity and delegated API authorization
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
      Then the public resources are Agents, Agent installations, Agent installation enrollments, API resources, account connections, access requests, access grants, and audit events
      And Agent registrations, hosts, identity bindings, connection intents, OAuth integration records, and token leases remain private implementation records
      And each public resource has one canonical URI in its caller boundary
      And Agent installation representations never expose internal Host identifiers

  Rule: Agent identities remain stable across hosts and credentials

    @e2e @entrypoint:agent-protocol @journey:agent-identity-enrollment
    Scenario: A new Agent establishes a stable identity on its first protected API operation
      Given a new Agent connects Restish to the Realmroot OpenAPI contract
      When the Agent invokes whoami without a local Realmroot identity
      Then the transparent Restish authentication adapter registers locally generated host and Agent keys
      And the adapter names the Agent after its detected runtime and the Host after its local device
      And whoami waits while an authorized controller approves the Agent once from the hosted verification page
      And the adapter creates a personal stable identity through the approved Agent session
      Then Realmroot creates an Agent with a stable issuer and subject
      And the Agent belongs to exactly one home space
      And users govern the Agent through explicit access grants in that space
      And the host registration is bound to that Agent identity
      And the original whoami operation resumes and returns the stable issuer and subject
      And the hosted approval page replaces the request with a clear completion state that says it can be closed
      And later OpenAPI operations reuse the Agent identity without another login command
      And the adapter requests only the bootstrap scopes published by Agent discovery
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
      Then the plugin reuses one stable Agent issuer and subject for that runtime
      And Restish API names, profiles, and runtime session identifiers do not create another Agent identity
      And another runtime on the same device and Realmroot issuer shares the Host registration
      But each runtime keeps a separately secured Agent key and stable Agent identity
      And another Realmroot issuer uses a separately secured local identity
      And an explicitly supplied AGENT runtime selects that runtime identity instead of the detected runtime

    @e2e @entrypoint:product-ui @journey:agent-enrollment-denial
    Scenario: A controller can deny Agent enrollment
      Given an Agent login request is pending
      When the authorized controller denies the request
      Then Realmroot resolves the existing AgentAuth approval as denied
      And the hosted approval page clearly says the request was denied and can be closed
      And the waiting Restish command exits without receiving an Agent identity

    @entrypoint:agent-protocol @journey:agent-multi-host-continuity
    Scenario: One Agent identity can be used from independently secured hosts
      Given an Agent identity has an active host registration
      When the Agent client requests another enrollment for that stable Agent from a host with a different public key and an idempotency key
      Then Realmroot creates a pending Agent installation enrollment and returns its hosted approval URL
      And the Agent client can poll that installation enrollment through its canonical Agent protocol URI
      And retrying with the same idempotency key returns that same installation enrollment
      When an authorized controller approves the hosted enrollment
      Then both host registrations resolve to the same Agent issuer and subject
      And neither host receives the other host's private key

    @entrypoint:agent-protocol @journey:agent-host-revocation
    Scenario: Revoking one host does not revoke the Agent identity
      Given an Agent identity has two active host registrations
      When a controller revokes one host
      Then that host can no longer authenticate as the Agent
      And the other host and the Agent identity remain active

    @entrypoint:product-ui @journey:agent-identity-recovery
    Scenario: A controller replaces compromised Agent credentials without changing its subject
      Given an Agent's host credentials may be compromised
      When an authorized controller recovers the Agent
      Then every existing host credential and session is revoked
      And external API resource grants are frozen
      And the Agent becomes inactive without entering a recovering state
      And the Agent keeps the same issuer and subject

    @entrypoint:product-ui @journey:agent-identity-deletion
    Scenario: A soft-deleted Agent subject is never reassigned
      Given an Agent has a stable issuer and subject
      When an authorized controller deletes the Agent
      Then the Agent can no longer authenticate, receive grants, or be queried through an interface
      And its subject remains reserved for historical audit records
      And no interface can restore it

    @entrypoint:agent-protocol @journey:agent-stable-issuer
    Scenario: Agent identity uses the deployment's existing OIDC issuer
      Given Realmroot is reached through a non-canonical request origin
      When a controller approves an Agent enrollment
      Then the Agent issuer is the Better Auth OIDC issuer
      And preview or request origins do not change the Agent issuer and subject
      And DPoP request binding and Agent links use only an origin allowed by TRUSTED_ORIGINS
      And hosted Agent approval URLs use the configured deployment origin
      And Realmroot does not publish a second Agent-only OIDC issuer

    @entrypoint:product-ui @journey:public-agent-profile
    Scenario: External visitors resolve a stable public Agent profile
      Given a non-deleted Agent has a stable issuer and subject
      When an external visitor requests the Agent by its stable subject
      Then Realmroot returns the Agent's public identity
      And picture resolves to the Realmroot static file "/agent-picture-v1.svg" until the Agent has a custom picture
      And the default summary omits owner and activity
      And the full view includes the public owner, activity overview, annual heatmap, and sanitized recent activity
      And Agent configuration and OAuth authorization-server discovery publish the AgentInfo URI template keyed by subject
      And permits each view to be cached and revalidated independently
      But the public profile never returns Host, role, scope, grant, Resource, or authorization state
      And the public profile is never authoritative for authentication or authorization

  Rule: Resource Servers expose provider-owned Resources through one Agent access workflow

    @entrypoint:agent-protocol @journey:realmroot-built-in-resource-server
    Scenario: Realmroot exposes its own API as a system-managed Resource Server
      Given a Realmroot deployment has completed onboarding
      And its persisted system-managed scope registry predates the current Realmroot scope catalog
      When an Agent lists Resource Servers
      Then exactly one enabled native Resource Server represents that deployment's Realmroot API
      And its service URL and OAuth resource indicator use the deployment's canonical API URL
      And Realmroot reconciles its persisted scope registry to the current system-managed catalog
      And refreshing that registry returns the same current catalog without an external network dependency
      And its account connection status is not-required
      And it cannot be disabled, soft-deleted, or reassigned through tenant management
      When the Agent lists that Resource Server's Resources
      Then the built-in platform Organization, ordinary Organization, and personal User Resources reflect the controller tenant boundaries available for approval
      And the platform Organization Resource supplies platform-wide management scopes
      And each Organization or User Resource supplies only scopes valid for that tenant boundary
      And every controller can approve scopes only within the selected Resource boundary
      And a platform Organization credential retains only the Agent's automatic protocol scopes plus approved management scopes
      And a token for one Resource cannot authorize another Resource
      When the Agent reads Resource Servers with either bootstrap or resource-bound authority
      Then Realmroot returns the same canonical Resource Server representation
      And the credential authority changes only which Resource Servers the Agent may read or mutate

    @entrypoint:agent-protocol @journey:agent-resource-server-model
    Scenario: An Agent discovers Resource Servers before provider-owned Resources
      Given Realmroot has registered native and external Resource Servers
      When the Agent lists Resource Servers
      Then each item identifies one protected API service, its service URL, OAuth resource indicator, availability, and account connection status
      And the Agent-facing contract does not call a Resource Server an API Resource
      When the Agent lists one Resource Server's Resources
      Then each item identifies one provider-owned authorization target with safe display metadata
      And each Resource separately reports account authorization, Agent-authorized scopes, and requestable scopes
      And an Organization owner may approve current assigned scopes of a Resource Server owned by that Organization
      And provider-specific RFC 9396 authorization details remain internal to Realmroot

    @entrypoint:agent-protocol @journey:agent-private-resource-server-visibility
    Scenario: A private Resource Server stays inside its owner Organization boundary
      Given a private Resource Server is owned by an Organization and available to Agents
      And a personal Agent's controller is an active member of that Organization
      When the Agent lists Resource Servers or directly reads that Resource Server's Resources
      Then the private Resource Server is visible to that Agent
      But it remains hidden from Agents outside the owner Organization
      And discovery grants no Resource scope or credential

    @entrypoint:restish @journey:restish-generic-interactive-resource
    Scenario: Restish handles every Realmroot controller interaction through one response profile
      Given any Realmroot operation returns the interactive-resource profile with an approval URL and canonical self link
      When the Restish response middleware receives the response
      Then the plugin recognizes the profile without matching the request method, path, operation identifier, or business response shape
      And opens the supplied same-issuer approval URL
      And polls the supplied self link according to Retry-After
      And returns the terminal resource representation
      But the plugin never parses an approval secret or constructs a Realmroot polling endpoint

    @entrypoint:restish @journey:restish-generic-resource-credential-offer
    Scenario: Restish registers a Resource credential without observing Realmroot grant internals
      Given an approved access request returns a DPoP resource-credential offer
      When the Restish response middleware handles that offer
      Then the plugin retains only the opaque credential source reference and server-supplied offer
      And returns a safe receipt that identifies the Restish credential source
      When the Agent adds that credential source to the target Restish API
      Then Restish creates and retains the DPoP private key locally
      And asks the plugin to redeem the offer with a proof for the exact supplied method and URI
      When the target authorization server requires a DPoP nonce
      Then Realmroot preserves the structured nonce challenge through the credential source
      And Restish retries once with the same private key and a fresh proof containing that nonce
      And Restish retains a nonce supplied with a successful credential for the next renewal
      And Restish stores but never prints the returned short-lived credential
      But the plugin never reads a grant, chooses an authorization mode, discovers an authorization server, or constructs a token endpoint

    @entrypoint:product-ui @journey:native-api-resource-registration
    Scenario: An administrator registers a native API that trusts Realmroot
      Given a product uses Realmroot as its OIDC provider and OAuth authorization server
      When an administrator creates an API resource with native authorization mode
      Then the administrator configures one protected resource URL
      And Realmroot uses that URL as the OAuth resource identifier and access-token audience
      And no external authorization server, OAuth client, or account connection is configured
      And the product API validates Realmroot access tokens with the published issuer and JWKS
      And the protected resource publishes its requestable scopes through RFC 9728 metadata
      And the protected resource advertises its OpenAPI contract with a standard service-desc link
      And Realmroot derives its local scope registry from that protected-resource metadata
      And scope registry refresh first refreshes dynamic connector metadata before validating provider compatibility
      And OpenAPI may add descriptions and maps operations only to advertised scopes
      And advertised scopes remain valid even when no public operation references them
      And Realmroot stores only discovered scope metadata and local grant modes, never either source document

    @entrypoint:product-ui @journey:api-resource-contract-validation
    Scenario: API resources require a discoverable OpenAPI contract
      Given an API resource URL cannot be reached or does not return a successful service-desc response
      When an administrator creates or enables the API resource, including a disabled registration
      Then Realmroot rejects the request without enabling the resource
      And a network failure identifies whether the resource or its OpenAPI document was unreachable
      When the administrator enables an existing draft or changes an enabled resource URL
      Then Realmroot validates the exact resource URL before saving the change

    @entrypoint:agent-protocol @journey:native-api-resource-access-request
    Scenario: An Agent requests access to a native API
      Given an enabled native API resource belongs to the Agent's home space
      When the Agent lists available resources
      Then Realmroot returns that resource and its protected resource URL without requiring an account connection
      When Restish reads the target OpenAPI operation and the Agent requests its exact scope set
      Then Realmroot validates that scope set against the local target scope registry
      And Realmroot verifies the controller currently holds every requested scope
      And Realmroot creates the same pending access-request resource used for external APIs
      And it does not require a user-created authority grant or grant identifier
      When an authorized controller approves the request
      Then the approval preserves the exact requested authorization details without an Account Connection
      Then Realmroot creates the same access-grant resource used for external APIs

    @entrypoint:agent-protocol @journey:agent-resource-discovery-isolation
    Scenario: An unavailable API resource does not block resource discovery
      Given multiple enabled API resources are visible to an Agent
      And one resource cannot publish its current OpenAPI contract
      When the Agent lists available resources
      Then Realmroot returns the resource with unavailable status and no requestable scopes
      And returns every available resource with available status and its current requestable scopes

  @entrypoint:agent-protocol @journey:agent-resource-access-without-role
    Scenario: An Agent requests resource access without a Role model
      Given an enabled API resource publishes the requested assigned scope in its local registry
      When the Agent requests that exact scope
      Then Realmroot allows the access request to proceed to controller approval
      And the controller may approve only scopes within the controller's effective scope set
      And an approved Agent grant stores that exact scope snapshot without a roles claim

    @e2e @entrypoint:agent-protocol @journey:native-api-resource-token
    Scenario: An Agent calls a native API directly
      Given a controller approved an exact native API resource request
      When Restish accepts the approved access request's credential offer
      Then the Realmroot plugin creates and retains a separate DPoP key
      And the plugin sends the DPoP proof in the standard DPoP header
      Then Realmroot issues a short-lived audience-bound JWT access token
      And the token uses the Better Auth issuer and signing keys
      And the token identifies the controller as subject and the stable Agent as the RFC 8693 actor
      And the Agent actor carries its issuer, subject, and ai_agent subject profile
      And the Host remains internal credential, binding, revocation, and audit context
      And the token carries only the approved scopes
      And groups identifies the Agent's organization home space
      And the token does not contain Agent roles
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
    Scenario: Restish manages target credentials without observing access grants
      Given Restish stores a DPoP credential obtained through the Realmroot credential source
      When another approved access request returns a credential offer for the same Resource Server
      Then the plugin replaces only the stored offer for that Resource without reading or selecting an access grant
      And does not alter Restish credentials for other authorization contexts
      And target requests use only the explicitly configured Restish DPoP credential
      When a short-lived credential expires while its server-managed authority remains active
      Then Restish asks the credential source to renew it through the stored opaque credential endpoint
      When Realmroot rejects credential renewal
      Then Restish removes the rejected access token but retains the credential source binding
      And the Agent must request current Resource access
      When the target API rejects a cached DPoP credential with HTTP 401
      Then Restish removes the rejected access token
      And the Agent must discover the current connection state and request current Resource access before retrying

    @entrypoint:restish @journey:restish-deep-resource-response
    Scenario: Restish preserves deeply nested resource responses
      Given a registered API resource returns a valid deeply nested document such as an OpenAPI contract
      When Restish passes that response through the Realmroot response middleware
      Then the middleware accepts the document within its bounded structural limits
      And Restish returns the resource response unchanged

    @entrypoint:restish @journey:restish-target-token-origin
    Scenario: Target token refresh uses the stable Agent issuer
      Given one Realmroot issuer is available through a canonical origin and an alternate profile origin
      And the alternate profile was the last Realmroot connection used by the Agent
      When Restish refreshes a native API resource token from an existing grant
      Then the plugin requests the token from the canonical origin of the stable Agent issuer
      And the DPoP proof is bound to that canonical target token endpoint
      And the native API resource URL and active target profile do not change the proof target
      When Restish refreshes an external API resource token from an existing grant
      Then the plugin still requests the Realmroot token operation from the canonical issuer origin
      And the external DPoP proof remains bound to the target platform's discovered token endpoint

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
    Scenario: An administrator creates an external API resource with an OIDC connector
      Given a target resource publishes protected-resource and authorization-server metadata
      And a platform-managed standard OIDC connector exists for its authorization server
      And Realmroot can discover that connector through OIDC or RFC 8414 authorization-server metadata
      When a member with the required platform Organization scopes creates the API resource and selects that connector
      Then Realmroot validates the resource issuer, token exchange, DPoP, and revocation against the connector
      And the external Resource Server is owned by the built-in platform Organization
      And ordinary Organizations cannot register or take ownership of it
      And the resource URL advertises its OpenAPI contract with a standard service-desc link
      And Realmroot derives every requestable scope only from scopes_supported in that protected-resource metadata
      And the OpenAPI contract may add descriptions for advertised scopes
      And Realmroot publishes only operation security alternatives fully supported by those advertised scopes
      And unrelated scoped operations do not prevent resource synchronization
      And authorization-server scopes_supported is not a scope catalog
      And the resource stores only its connector association rather than another OAuth client
      And the resource cannot be enabled for Agents when a required capability is absent
      And the same connector can independently be enabled for Realmroot login

    @entrypoint:restish @journey:external-api-resource-reconfiguration
    Scenario: Changing an external API resource URL revalidates its connector boundary
      Given an external API resource is associated with an active OIDC connector
      When an administrator changes its resource URL or selects another OIDC connector
      Then Realmroot rediscovers the target metadata
      And the resource remains enabled only when its authorization server matches the associated connector
      And the resource cannot remove its connector or become natively authorized

    @entrypoint:restish @journey:external-api-resource-canonical-callback
    Scenario: OIDC connector registration uses the deployment's canonical callbacks
      Given Realmroot is reached through a non-canonical request origin
      When an administrator dynamically registers an OIDC connector
      Then its login and resource-account redirect URIs and JWKS URI use the configured deployment origin
      And a later Account Center authorization request uses that same redirect URI
      And a successful resource-account callback shows completion even when origin-scoped session storage is unavailable

    @entrypoint:agent-protocol @journey:external-resource-dynamic-client-scope-upgrade
    Scenario: A dynamic OIDC connector upgrades its registered scope authority
      Given an authorization server advertises scopes that were not registered by an existing dynamic connector
      When a controller expands an external resource account for one of those scopes
      Then Realmroot updates the existing client through its registration management endpoint when available
      And otherwise Realmroot registers a new client generation without invalidating connections pinned to the previous generation
      And the connection intent is pinned to the new client generation
      And same-subject reauthorization preserves the selected account connection identity and switches only that connection to the new generation

    @entrypoint:product-ui @journey:external-resource-rich-authorization-connection
    Scenario: A controller connects one external subject to multiple target contexts
      Given an authorization server advertises RFC 9396 authorization detail types and an RFC 9126 pushed authorization request endpoint
      And an external API resource configures opaque connection authorization detail templates using supported types
      When Realmroot dynamically registers its reusable OIDC connector
      Then the registration declares the authorization detail types that the connector can use
      When the controller authorizes the resource account
      Then Realmroot pushes the complete authorization request including the configured authorization details
      And sends only the returned one-time request URI through the browser
      When the target consent enriches one template into multiple granted contexts
      Then Realmroot requires and stores every returned authorization detail under the single account connection
      And refresh-token rotation preserves the granted authorization details
      And unknown types or malformed authorization details fail with invalid_authorization_details

    @entrypoint:agent-protocol @journey:external-resource-rar-without-catalog
    Scenario: Rich authorization does not require an enumerable resource catalog
      Given an authorization server supports RFC 9396 authorization details and RFC 9126 pushed authorization requests
      And it does not advertise Realmroot's optional authorization detail catalog extension
      When an administrator registers an external API resource with supported authorization detail templates
      Then Realmroot accepts the resource without inventing a catalog requirement
      And Agents can request exact details already exposed by their connected account

    @entrypoint:agent-protocol @journey:external-resource-contextual-delegation
    Scenario: An Agent delegates an exact external-resource context alongside scopes
      Given one external account connection grants multiple opaque authorization detail entries
      And the authorization server advertises Realmroot authorization detail catalog version 1 with an account-scoped endpoint and required scope
      When the Agent discovers that catalog through Realmroot
      Then Realmroot forwards pagination and returns each available detail with safe display metadata and connection authorization
      And each detail reports only its Agent-authorized and requestable scope sets
      And Realmroot does not expose account connection identifiers, grant identifiers, grants, or tokens
      When the Agent requests an exact scope subset and one or more concrete connected authorization details
      Then Realmroot preserves that exact authorization boundary through hosted approval
      And rejects missing, generic, duplicate, or unconnected authorization details
      And the pending request and controller approval preserve both authority dimensions
      And an ungranted entry or browser-tampered approval fails with invalid_authorization_details
      When the controller approves the request and the Agent exchanges a token
      Then Realmroot sends the approved scopes and authorization details to the target authorization server
      And requires the target token response to return the exact assigned scopes and authorization details
      And stores both dimensions with the token lease
      And audit events expose only safe authorization detail type and identifier projections

    @entrypoint:product-ui @journey:external-resource-rich-authorization-reauthorization
    Scenario: Reauthorization removes stale contextual authority without changing non-RAR resources
      Given an existing external resource account has active contextual Agent grants
      When reauthorization no longer returns one previously granted authorization detail entry
      Then Realmroot prevents future issuance from every grant containing the removed entry
      And existing connections must be explicitly reauthorized when their resource becomes RAR-required
      And resources without configured authorization details preserve their existing connection, refresh, grant, token exchange, revocation, and audit behavior

    @e2e @entrypoint:agent-protocol @journey:external-resource-first-access
    Scenario: An Agent requests first access to an external API resource
      Given an enabled external API resource has active authorization configuration
      And the Agent's home space has no account connection for that resource
      When the Agent discovers every target operation required by the current task
      And requests a controller-managed account connection for their combined exact advertised scope set
      Then Realmroot creates a hosted connection request without authorization details or an Agent grant
      When the controller opens the connection approval page
      Then Realmroot requires the controller to connect that resource account
      And the new account authorization requests the connection request's exact scope set
      When OAuth returns after connecting the account
      Then Realmroot returns to the connection approval with that account displayed
      When the authorization server instead returns an OAuth error
      Then Realmroot consumes the failed attempt and returns to the connection approval with the provider error and a retry action
      Then Realmroot records a resource account connection owned by the Agent's home space
      And stores its refresh credential encrypted
      And never exposes the refresh credential through an API, audit event, or error
      And does not create an Agent access request, grant, or token
      When the Agent discovers one connected authorization context and separately requests exact access
      And the controller approves the exact Agent scopes and grant lifetime
      Then Realmroot binds the account connection to the exact request and grant
      And the Agent can obtain a DPoP-bound target access token

    @entrypoint:product-ui @journey:resource-account-reauthorization
    Scenario: A controller reauthorizes a connected external resource account
      Given the controller's home space already has an account connection for an external API resource
      And a pending Agent access request requires scopes that connection does not yet cover
      When the controller opens the approval page
      Then Realmroot displays the connected account as requiring expanded authorization
      And prevents approval until the account covers every requested scope
      When the controller reauthorizes that account for the union of its existing scopes and the pending Agent request's exact scope set
      And OAuth returns the same external subject with replacement credentials and scopes
      Then Realmroot preserves the account connection identity
      And replaces its encrypted credentials, scopes, display name, and expiry
      And treats the callback authorization details as authoritative so removed details invalidate uncovered Agent grants
      And restores the connection when it was previously revoked
      And returns to the pending Agent approval so the controller can decide it separately

    @entrypoint:agent-protocol @journey:resource-account-connection-expansion
    Scenario: An Agent requests additional authority from an existing resource account
      Given the Agent's home space has an active resource account connection with covered persistent grants
      When the Agent requests a controller-managed connection for an additional scope
      Then Realmroot leaves the account connection revision, authorization details, and grants unchanged while approval is pending or interrupted
      When the controller starts account reauthorization
      Then Realmroot requests the union of the account's still-advertised resource scopes and the Agent's additional scope
      And Realmroot adds provider protocol scopes only after validating that resource scope union
      And only a successful OAuth callback may replace the account authorization and invalidate grants it no longer covers

    @entrypoint:agent-protocol @journey:agent-resource-discovery
    Scenario: An Agent discovers resource connection and scope status before requesting exact authority
      Given enabled native and externally authorized API resources exist
      When the Agent lists available resources
      Then Realmroot returns enabled resources even when an external resource has no connected account
      And a temporarily unreachable external authorization server does not fail the Resource Server collection or revoke its account connection
      And returns each resource server with its protected URL, available scopes, and one connected, not-connected, or not-required account status
      And a connected account reports only its safe display label and connection-authorized scopes
      And Realmroot does not expose Connector, account connection, grant, or token identifiers
      When Restish connects directly to a candidate resource and reads the target OpenAPI operation
      And the Agent requests an account and its exact scope set without an applicable grant
      Then Realmroot validates that scope set against the local target scope registry
      And automatic scopes do not apply to Agents
      And the connected account permits every requested scope
      Then Realmroot creates one pending access request and returns a hosted approval URL
      And it does not require a pre-existing Agent resource grant

    @entrypoint:agent-protocol @journey:agent-resource-connection-ensure
    Scenario: An Agent connects a resource without observing account connection internals
      Given an Agent requests least-privilege scopes for an external API resource
      When the controller completes the hosted resource connection approval
      Then the Restish plugin resolves that exact request through a hidden adapter boundary
      And the public connection response reports connected without an account connection identifier

    @entrypoint:agent-protocol @journey:agent-resource-access-ensure
    Scenario: An Agent ensures exact resource access without selecting grants or tokens
      Given an Agent names an API resource, exact authorization details, and least-privilege scopes
      When the Agent requests that exact access
      Then Realmroot resolves the unique account connection from the Agent's home space and API resource
      Then Realmroot reuses an exact active grant without controller approval when one exists
      And otherwise creates or resumes one pending controller approval
      And the public access-request contract never exposes grant identifiers or token operations
      And the Restish plugin resolves approved access through a hidden adapter boundary
      And the plugin obtains, protects, and activates a short-lived DPoP target token
      And the Agent never selects a grant or invokes a token operation
      And the plugin returns a safe ready receipt without grant identifiers or token material

    @entrypoint:product-ui @journey:agent-resource-approval
    Scenario: A controller decides an Agent resource request in one step
      Given an Agent resource access request is pending
      When an authorized controller approves it
      Then the controller confirms the named Agent, named resource, displayed resource account, exact scopes, and one-time, limited, or persistent mode
      And the Account Center request queue identifies the named Agent and named resource before the controller opens the decision
      And expired requests do not appear in the Account Center request queue
      And stable Agent and resource identifiers remain visible as supporting information
      And limited access accepts an exact future local date and time while rejecting empty or past values
      And no account-selection control is displayed
      And scope expansion, another account, or another resource requires a new approval
      And a denied request cannot issue a target token
      And an incomplete approval URL shows only a recovery state without inactive authorization controls

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
      When the Restish plugin completes the Agent's exact access request
      Then the Realmroot plugin creates and retains a separate DPoP key
      And the plugin sends a standard DPoP header bound to the target token endpoint
      Then Realmroot submits a signed Agent assertion with the RFC 7523 JWT bearer grant
      And the target platform issues an Agent access token
      And Realmroot exchanges the connected user's subject token and the target-issued Agent access token with RFC 8693
      And the target platform issues a short-lived DPoP-bound access token
      And the token identifies the target user as subject and the Agent in the RFC 8693 actor claim
      And the target preserves the Agent issuer, subject, and ai_agent subject profile
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

    @entrypoint:product-ui @journey:agent-governance-audit
    Scenario: Agent identity and management authority changes remain auditable
      Given an Agent identity is governed by a controller or administrator
      When the Agent is enrolled, recovered, retired, or receives a capability decision
      Then Realmroot records the action, result, controller, stable Agent identity, host, and affected capabilities
      And the audit event contains no host credential, session token, or approval code
