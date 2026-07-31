# Agent Identity Architecture

Realmroot separates a durable Agent identity from the host registration and key
that currently presents it. This lets an Agent survive host replacement and key
rotation without changing its public identity or silently carrying authority
between unrelated hosts.

## Identity Model

Realmroot owns three records outside AgentAuth:

- `agent_identity` is the stable product identity. It has one personal or
  organization home space and an immutable `(issuer, subject)` identifier.
- `agent_identity_binding` associates a host-specific AgentAuth registration
  with the stable identity.
- `agent_enrollment_intent` is the fail-closed handoff between protocol
  registration and controller approval.

AgentAuth remains the protocol adapter and source of host keys. A registered
host without an active identity binding has no identity-level authority.

The Restish adapter keys protected local identity state by the discovered
Realmroot issuer and Agent runtime. API names, profiles, and individual runtime
sessions are request contexts, not identities. The same runtime therefore
reuses one stable Agent across aliases and profiles that resolve to the same
issuer; another runtime or issuer gets separately secured state.

Recovery preserves `(issuer, subject)`, revokes current registrations and
bindings, and waits for a controller-approved replacement. Retirement is
permanent: the subject stays reserved while all bindings remain revoked.

## Federation Boundary

Agents and product users share the deployment's Better Auth issuer:

```text
AUTH_ORIGIN/api/auth
```

Realmroot does not publish a second Agent-only issuer. OIDC remains the
federation vocabulary, while the Agent profile defines how a stable non-human
subject relates to hosts and controllers.

The Host authenticates the current AgentAuth registration; it is not an
identity exposed to resource servers. For native API access, the controlling
user or organization is the access-token subject and the stable Agent is the
RFC 8693 actor. The DPoP confirmation claim proves possession of the separate
resource key without turning that key or Host into an identity.

## Authority Model

Enrollment establishes identity only. API authority starts with a request from
the Agent for one API Resource and an exact scope set. External resources also
bind the request to one connected target account. A controller decision creates
an access grant with one-time, limited, or persistent lifetime.

Authority is never inferred from enrollment, home-space ownership, Connector
configuration, or account connection. Expanding scopes, changing the external
account, or changing the resource requires a new decision.

The public lifecycle is intentionally expressed as Agent enrollment, access
request, access grant, and audit event resources. Host credentials, identity
bindings, OAuth connection intents, encrypted refresh credentials, and target
token leases remain internal security records rather than parallel public
resources.

Realmroot Resource API authority is separate from business API authority.
Operation-specific `{resource}:read` and `{resource}:write` capabilities allow
an Agent to administer Realmroot; they do not issue product API tokens or
impersonate a controller.

## Connectors And API Resources

Connectors authenticate people to Realmroot. API Resources describe protected
business APIs and use one authorization mode:

- `native`: the product uses Realmroot as its authorization server. The
  protected API trusts the Realmroot issuer and JWKS and needs no external
  account connection.
- `external`: the target owns its users and authorization server. It publishes
  RFC 9728 protected-resource metadata and RFC 8414 authorization-server
  metadata. Realmroot integrates through authorization code with S256 PKCE and
  refresh credentials, RFC 7523 JWT bearer assertions, RFC 8693 token exchange,
  RFC 9449 DPoP, and RFC 7009 revocation. OAuth clients may be dynamically
  registered through RFC 7591 or configured by an administrator.

The protected resource advertises its OpenAPI contract through an RFC 8631
`service-desc` link. That contract is authoritative for scope names and
operation requirements.

External account connections store encrypted refresh credentials but grant no
Agent authority. `CREDENTIAL_ENCRYPTION_KEY` protects those credentials along
with OAuth client secrets, PKCE verifiers, and active token leases using
purpose-specific AES-GCM envelopes.

## Direct API Access

Realmroot is not an HTTP proxy. In both modes, an approved grant produces a
short-lived, audience-restricted, DPoP-bound token that the Agent presents
directly to the protected API.

The Restish adapter owns a separate P-256 DPoP key per resource grant and keeps
the resulting target token in protected local state. It retains only the
current grant credential for an API Resource: approving a replacement grant
replaces the old grant binding and DPoP key. Agent and Host proof keys, resource
DPoP keys, and external-account refresh credentials are different credential
domains; none of them is a substitute identity for the stable Agent.

For `native`, Realmroot signs an `at+jwt` with its managed issuer keys. The
token contains:

- the protected resource audience;
- the exact approved scope set;
- the Agent's personal-owner user ID or organization home-space ID as `sub`;
- the stable Agent issuer and subject in `act`, classified by
  `sub_profile: ai_agent`;
- the DPoP public-key thumbprint in `cnf.jkt`;
- effective resource roles and the organization home space when applicable.

The protected API validates token type, signature, issuer, audience, expiry,
scope, and the DPoP proof including its access-token hash.

For `external`, Realmroot refreshes the connected user's subject token when
needed and submits a stable-Agent assertion using RFC 7523. The target issues an
Agent actor token, then intersects the subject's scopes with the approved Agent
scopes during RFC 8693 token exchange. The target authorization server issues
the final DPoP-bound token with the connected user as `sub` and the Agent in
`act`. Targets that support Realmroot AgentInfo preserve the Agent's original
issuer, subject, and `ai_agent` subject profile.

## Agent Display Information

Resource servers discover `agentinfo_endpoint` from the Agent issuer's OIDC or
OAuth metadata and resolve the exact `(act.iss, act.sub)` pair. AgentInfo is a
public, cacheable presentation projection containing the stable identifier,
name, picture, and update time. Agents without a custom picture use Realmroot's
versioned static placeholder at `/agent-picture-v1.svg`. AgentInfo excludes
controllers, home spaces, Hosts, roles, scopes, grants, and authorization state.

AgentInfo remains available for retired subjects so historical audit records
keep a useful display name. It is never an authentication, authorization, or
revocation input.

Realmroot returns no target refresh token to the Agent. Revoking the grant,
connection, credential, Agent, or host stops new issuance; active external
leases are sent to the target's RFC 7009 revocation endpoint.

Runnable implementations live in the
[native resource server](../../examples/native-resource-server/README.md) and
[external resource server](../../examples/external-resource-server/README.md)
examples.

For the product-level enrollment and access journey, see the
[Agent access guide](../guides/agent-access.md).

## Audit Boundary

Enrollment, access requests, controller decisions, token issuance, and
revocation record the principal, controller authority, Agent, host, resource,
account connection, grant, scopes, and outcome. Credentials, authorization
headers, raw access tokens, and complete request or response bodies are excluded.
