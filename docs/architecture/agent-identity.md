# Agent identity architecture

## Status

Implemented.

## Context

AgentAuth models protocol hosts and per-host Agent registrations. Those records
authenticate a key holder, but they are not the durable product identity of an
Agent. A durable identity must survive host replacement and key rotation, retain
one home space, and remain addressable as an immutable `(issuer, subject)` pair.

OIDC remains the federation vocabulary, but OIDC Core describes an End-User
subject. FlareAuth therefore publishes an Agent profile on top of OAuth/OIDC
rather than representing the public key or an AgentAuth row as the account
identifier.

## Decision

FlareAuth owns three records outside AgentAuth's schema:

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
`BETTER_AUTH_URL`; request and preview origins are not identity inputs. FlareAuth
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

The durable Agent is identified by top-level `iss` and `sub`. A host key proves
the current presenter, not the durable identity. Autonomous tokens use the Agent
as subject and the host as actor. Delegated tokens use the delegating user or
organization as subject and represent Agent and host in the actor chain following
RFC 8693 semantics. Agent-specific subject type and host claims are a documented
FlareAuth extension; ordinary OIDC relying parties may treat the subject as a
normal account, while Agent-aware parties can enforce the extension.

FlareAuth exposes the shared issuer metadata at
`/api/auth/.well-known/openid-configuration`, public signing keys at
`/api/auth/jwks`, and all OAuth grants at `/api/auth/oauth2/token`. Agent access
tokens are five-minute JWTs signed by Better Auth's managed issuer keys with an
`at+jwt` type, audience, scopes, `cnf.jkt`, actor chain, and stable Agent
identity.

Every token request requires a fresh DPoP proof. JTI state is consumed
atomically, so a proof cannot be replayed. Token records remain in D1 so host,
identity, authority-grant, and external-resource-grant revocation takes effect
immediately instead of waiting for JWT expiry.

## Authority

An authority grant is either autonomous or delegated:

- Autonomous authority uses the Agent subject; the presenting host is the
  actor.
- Delegated authority uses the controlling user or organization as subject;
  the Agent and host form the actor chain.

Grants are audience- and scope-bound and can additionally restrict hosts,
activation time, total uses, expiry, and one-time controller approval. No
authority is inferred from enrollment, ownership, or Connector configuration.

For FlareAuth's own unified API, an autonomous grant with audience
`AUTH_ORIGIN/api` and `management:read`, `management:write`, or
`management:*` authorizes tenant operations. The request principal remains the
Agent `(issuer, subject)`; the user who approved the grant is authorization
provenance, not an impersonated CLI identity. Use-limited and step-up grants are
not accepted directly at this boundary because those constraints require the
separate token issuance and consumption flow.

## Restish and the unified API

FlareAuth publishes one automation contract at `/api/openapi.json`, with `/api`
as its server root. `whoami` and permission-gated resource operations are
generated from that contract. `/api/management` remains a compatibility path
for existing clients but is not a separate Restish command or identity model.

The Restish plugin implements only the `auth` hook. On the first protected
operation it creates local Agent and Host keys, starts AgentAuth enrollment,
waits for one controller approval, binds the stable identity, signs the original
request, and lets it continue. It does not expose `login`, `whoami`, or resource
commands. Every later command-line request is authenticated as the same Agent.

## Connectors and external API Resources

Connectors authenticate people to FlareAuth. They remain limited to social and
generic OAuth/OIDC sign-in providers. They do not describe business APIs,
credentials, request paths, or proxy behavior.

API Resources authorize access. An API Resource in `external` authorization
mode points to a target protected resource and is configured from its RFC 9728
resource URL. FlareAuth discovers RFC 8414 metadata and requires authorization
code with PKCE and refresh, the RFC 7523 JWT bearer grant, RFC 8693 token
exchange, RFC 9449 DPoP, and RFC 7009 revocation. The target can use RFC 7591
dynamic client registration or an administrator can enter a client ID and
secret. Dynamic registration records FlareAuth's standard `jwks_uri`; no
FlareAuth-specific discovery or registration fields are used.

Account Center lets a user or authorized organization controller connect a
target account through authorization code with S256 PKCE. The connection's
refresh credential is encrypted and never returned by an API. Connecting an
account grants no Agent permission.

An Agent discovers enabled resources and redacted accounts in its home space,
then requests one account and an exact scope set. An authorized controller
approves or denies that request in one step and chooses one token lease,
time-limited, or persistent authority. Scope expansion, a different account, or
a different resource requires a new decision.

`CREDENTIAL_ENCRYPTION_KEY` supplies AES-GCM key material for Connector client
secrets, external-resource client secrets, OAuth PKCE verifiers, connected
account refresh credentials, and active token leases. Each envelope uses
randomized nonces and purpose-specific authenticated context.

## Direct target access

FlareAuth is not an HTTP proxy. After approval, the Agent presents a fresh DPoP
proof for the target token endpoint. FlareAuth refreshes the connected user's
subject token when required and signs a short-lived JWT assertion whose subject
is the stable Agent identity. FlareAuth submits that assertion through the RFC
7523 JWT bearer grant. The target validates it with the client's registered
`jwks_uri` and issues an Agent access token. FlareAuth then sends the user's
access token as `subject_token` and the target-issued Agent access token as
`actor_token` to the RFC 8693 token endpoint. Both token type parameters use the
standard access-token identifier. The target intersects the user's scopes with
the approved Agent scopes and issues its own short-lived DPoP-bound access
token.

FlareAuth returns that target access token without a refresh token. The Agent
calls the target API directly and proves possession of the same DPoP key. The
target token identifies the connected user as subject and the stable Agent in
the standard `act.sub` claim. Host identity remains internal governance and
audit context in FlareAuth; it is not a target-platform protocol claim.

Grant or connection revocation sends active target leases to the target RFC
7009 endpoint. Subsequent lease requests fail immediately. No credential
injection or FlareAuth egress endpoint exists.

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
