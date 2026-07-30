# Agent identity architecture

## Status

Implemented.

## Context

AgentAuth models protocol hosts and per-host Agent registrations. Those records
authenticate a key holder, but they are not the durable product identity of an
Agent. A durable identity must survive host replacement and key rotation, retain
one home space, and remain addressable as an immutable `(issuer, subject)` pair.

OIDC remains the federation vocabulary, but OIDC Core describes an End-User
subject. Realmroot therefore publishes an Agent profile on top of OAuth/OIDC
rather than representing the public key or an AgentAuth row as the account
identifier.

## Decision

Realmroot owns three records outside AgentAuth's schema:

- `agent_identity` is the stable product identity and has exactly one personal
  or organization home space.
- `agent_identity_binding` associates one AgentAuth `agent` registration with
  one stable identity. Different hosts use different registrations and keys.
- `agent_enrollment_intent` is the fail-closed handoff between AgentAuth
  registration and controller approval.

`agent_host` is not changed. AgentAuth remains the protocol adapter and source
of host-specific public keys.

The issuer is the deployment's existing Better Auth OIDC issuer,
`AUTH_ORIGIN/api/auth`. Deployments configure one stable production
`BETTER_AUTH_URL`; request and preview origins are not identity inputs. Realmroot
does not publish or operate a second Agent-only authorization server.

Enrollment approval atomically inserts the identity when needed, inserts its
binding, and consumes the intent. An AgentAuth registration with no active
binding is denied at every identity-level capability and token boundary. Plugin
audit callbacks are never used as a consistency mechanism because they are
background notifications whose failures do not fail registration.

Recovery preserves `(issuer, subject)`, moves the identity to `recovering`, and
revokes all current protocol registrations and bindings. Approving a replacement
host returns it to `active`. Retirement is permanent: the identity row and
subject remain reserved while all bindings are revoked.

## Federation profile

The durable Agent is identified by `(issuer, subject)`. A host key proves the
current presenter, not the durable identity. For a native API resource, the
access token uses the controlling user or organization as `sub` and represents
the Agent and host in the RFC 8693 actor chain.

Realmroot exposes shared issuer metadata at
`/api/auth/.well-known/openid-configuration` and public signing keys at
`/api/auth/jwks`. Access tokens for native API resources are five-minute
JWTs signed by Better Auth's managed issuer keys with an `at+jwt` type,
audience, scopes, `cnf.jkt`, and actor chain.

Every token request requires a fresh DPoP proof. JTI state is consumed
atomically, so a proof cannot be replayed. Token leases remain in D1 for audit
and revocation; new issuance stops immediately when the Agent, host, connection,
or access grant is revoked.

## Authority

API authority always begins with an Agent-created access request. The request
names one API resource, an exact permission set, and an account connection only
when the resource uses external authorization. Controller approval creates one
access grant with one-time, limited, or persistent lifetime. No API authority is
inferred from enrollment, ownership, Connector configuration, or a
controller-created grant.

Tenant management is separate: AgentAuth capability grants provide
`management:read` and `management:write` to the stable Agent principal. They do
not issue product API tokens or impersonate the approving controller.

## Restish and the unified API

Realmroot publishes one automation contract at `/api/openapi.json`, with `/api`
as its server root. `get-current-agent` and permission-gated resource operations are
generated from that contract. `/api/management` remains a compatibility path
for existing clients but is not a separate Restish command or identity model.

The Restish plugin implements only the `auth` hook. On the first protected
operation it creates local Agent and Host keys, starts AgentAuth enrollment,
waits for one controller approval, binds the stable identity, signs the original
request, and lets it continue. It does not expose `login`, `get-current-agent`, or resource
commands. Every later command-line request is authenticated as the same Agent.

## Connectors and API Resources

Connectors authenticate people to Realmroot. They remain limited to social and
generic OAuth/OIDC sign-in providers. They do not describe business APIs,
credentials, request paths, or proxy behavior.

API Resources authorize access and declare one mode:

- `native`: the product uses Realmroot as its OIDC provider and authorization
  server. Its API trusts the Realmroot issuer/JWKS and requires no account
  connection.
- `external`: the target owns its user and authorization system. It publishes
  RFC 9728 metadata; Realmroot discovers RFC 8414 metadata and requires
  authorization code with PKCE and refresh, RFC 7523, RFC 8693, RFC 9449, and
  RFC 7009. The target can use RFC 7591 dynamic client registration or an
  administrator-configured client.

Account Center lets a user or authorized organization controller connect a
target account through authorization code with S256 PKCE. The connection's
refresh credential is encrypted and never returned by an API. Connecting an
account grants no Agent permission.

An Agent discovers enabled resources and exact permissions. External resources
also return redacted accounts from its home space. The Agent requests an exact
permission set and includes an account only for external mode. An authorized
controller approves or denies that request in one step and chooses one token,
time-limited, or persistent authority. Permission expansion, a different
external account, or a different resource requires a new decision.

`CREDENTIAL_ENCRYPTION_KEY` supplies AES-GCM key material for Connector client
secrets, external-resource client secrets, OAuth PKCE verifiers, connected
account refresh credentials, and active token leases. Each envelope uses
randomized nonces and purpose-specific authenticated context.

## Direct API access

Realmroot is not an HTTP proxy. Both modes use the same Access Grant token
operation.

For `native`, Realmroot signs an audience- and permission-bound `at+jwt` for
the controlling identity. The token contains the Agent/host actor chain and the
Agent's DPoP key thumbprint. The product API validates the Realmroot issuer,
JWKS, audience, expiry, permissions, and DPoP proof.

For `external`, Realmroot refreshes the connected user's subject token when
required and submits a stable-Agent assertion through RFC 7523. It then uses the
user token and target-issued Agent token in RFC 8693 token exchange. The target
intersects the user's scopes with the approved Agent scopes and issues its own
short-lived DPoP-bound access token.

Realmroot returns no refresh token. The Agent calls the API directly and proves
possession of the same DPoP key. External target tokens identify the connected
user as subject and the stable Agent in `act.sub`; Realmroot-issued tokens
identify the controller as subject and include Agent and host actors.

Grant or connection revocation sends active target leases to the target RFC
7009 endpoint. Subsequent lease requests fail immediately. No credential
injection or Realmroot egress endpoint exists.

## Governance and audit

Account Center exposes personally owned stable identities, including permanent
retirement. Organization settings expose organization-owned identities.
Console exposes tenant-wide identity inventory, external resource authorization
audit, and emergency retirement. The unified OpenAPI publishes the same
governance operations for Restish clients.

Every resource request, controller decision, token issuance, and revocation
records controller authority, subject, Agent identity, host, resource,
connection, grant, exact scopes, result, and a bounded reason. Credentials,
authorization headers, and complete request or response bodies are excluded.

## Consequences

- There is no schema migration from AgentAuth metadata and no identity stored in
  untrusted Agent metadata.
- A protocol Agent may exist temporarily without a stable identity, but it has
  no identity-level authority until binding succeeds.
- One stable Agent may have multiple active hosts without sharing private keys.
- Connector authentication and external API Resource authorization are separate
  protocol surfaces that both build on the stable identity.
