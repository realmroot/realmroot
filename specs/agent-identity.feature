Feature: Agent identity and credential brokerage
  As an Agent controller
  I want Agents to have durable identities and constrained access to external accounts
  So that Agents can act independently or by delegation without receiving long-lived secrets

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
      And enrollment alone grants no management or external account access
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
      And external account grants are frozen
      And the Agent keeps the same issuer and subject

    @entrypoint:product-ui @journey:agent-identity-retirement
    Scenario: A retired Agent subject is never reassigned
      Given an Agent has a stable issuer and subject
      When an authorized controller permanently retires the Agent
      Then the Agent can no longer authenticate or receive grants
      And its subject remains reserved for historical audit records

    @entrypoint:agent-protocol @journey:agent-stable-issuer
    Scenario: Agent identity uses the deployment's canonical issuer
      Given FlareAuth is reached through a non-canonical request origin
      When a controller approves an Agent enrollment
      Then the Agent issuer is the configured canonical Agent identity issuer
      And preview or request origins do not change the Agent issuer and subject

  Rule: Tokens distinguish an Agent's identity from delegated authority

    @entrypoint:agent-protocol @journey:agent-autonomous-authority
    Scenario: An Agent can receive a token for its own authority
      Given an active Agent host proves possession of its registered key
      When it requests a token for the Agent's own resources
      Then FlareAuth issues a short-lived audience-bound token
      And the token identifies the Agent as subject and the host as actor
      And the token carries only explicitly granted scopes

    @entrypoint:agent-protocol @journey:agent-delegated-authority
    Scenario: An Agent can receive explicitly delegated authority
      Given a user or organization granted authority to an Agent
      When an active Agent host requests a token for that authority
      Then the token identifies the user or organization as subject
      And the token identifies the Agent and host as the acting chain
      And the token is limited by the delegation's scopes, constraints, and expiry

    @entrypoint:agent-protocol @journey:agent-oidc-federation
    Scenario: An OIDC relying party can associate an account with an Agent
      Given a relying party trusts the FlareAuth issuer
      When it validates an audience-bound token for an Agent
      Then it associates the account by issuer and subject
      And an Agent-aware relying party can distinguish the Agent subject and acting host
      And a relying party never needs the Agent's long-lived public key as its account identifier

    @entrypoint:agent-protocol @journey:agent-grant-policy
    Scenario: Agent authority is denied unless an applicable grant allows it
      Given an Agent host requests authority for a resource
      When no active grant permits the scope, resource, host, time, and usage constraints
      Then FlareAuth denies the request
      When an applicable grant permits the request but requires step-up approval
      Then FlareAuth waits for an authorized controller to approve the high-risk use

  Rule: External accounts keep ownership separate from Agent access

    @entrypoint:product-ui @journey:external-account-ownership
    Scenario: An external account has an explicit owner
      Given a Connector is configured for an external platform
      When a credential manager links an external account
      Then the account is owned by exactly one user, organization, or Agent
      And granting its use to an Agent does not transfer or copy ownership

    @e2e @entrypoint:product-ui @journey:external-account-connection
    Scenario: A credential manager establishes an Agent-usable external account
      Given an Agent requested access through a configured Connector
      When a credential manager completes OAuth authorization or supplies a header credential
      Then FlareAuth stores the resulting credential for the external account
      And the credential manager explicitly grants selected use to the Agent
      And the Agent cannot retrieve the long-lived credential

    @entrypoint:product-ui @journey:external-account-secret-custody
    Scenario: Connector and external account secrets remain confidential
      Given Connector client secrets and external account credentials are configured
      When an administrator or controller reads their configuration
      Then FlareAuth reports only whether each secret is configured
      And no API, audit event, or error response reveals secret material
      And replacing a secret does not return its previous value

    @entrypoint:product-ui @journey:external-account-credential-boundary
    Scenario: External accounts accept only supported API credentials
      Given a credential manager configures an external account
      When the credential uses OAuth, a bearer token, or a fixed header API key
      Then FlareAuth can store it for credential brokerage
      But passwords, cookies, browser sessions, query credentials, and custom request signatures are rejected

  Rule: The credential broker remains platform independent

    @e2e @entrypoint:agent-protocol @journey:agent-egress-proxy
    Scenario: An Agent uses an external account through constrained HTTP egress
      Given an Agent has a grant for an external account
      And its Connector fixes the target API origin and credential injection rule
      When an active host sends an allowed method and relative path through FlareAuth
      Then FlareAuth injects the external credential and forwards the request
      And the target response status, body, and permitted headers are returned
      And the Agent never receives the injected credential

    @entrypoint:agent-protocol @journey:agent-egress-boundaries
    Scenario: Egress cannot escape Connector and grant boundaries
      Given an Agent has a constrained external account grant
      When its host requests a forbidden method, path, origin, port, or redirect
      Then FlareAuth rejects the request before sending external credentials
      And the host cannot override authorization, cookie, host, or credential injection headers

    @e2e @entrypoint:agent-protocol @journey:agent-egress-revocation
    Scenario: Revocation immediately blocks credential brokerage
      Given an Agent host can use an external account through egress
      When a controller revokes the host, Agent, or external account grant
      Then subsequent token and egress requests are rejected
      And unrelated hosts and grants remain active

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
      Given an Agent host attempts to use an external account
      When FlareAuth allows or denies the request
      Then the audit record identifies the controller authority, subject, Agent, host, grant, target, and result
      And it excludes credentials, authorization headers, and complete request or response bodies
