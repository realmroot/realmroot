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

Every token request and brokered request requires a fresh DPoP proof. JTI state
is consumed atomically, so a proof cannot be replayed. Token records remain in
D1 so host, identity, authority-grant, and external-account-grant revocation
takes effect immediately instead of waiting for JWT expiry.

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

## Connector and credential brokerage

The existing Connector resource is the platform abstraction. FlareAuth does not
contain vendor-specific brokerage implementations. `generic_oauth` Connectors
use OIDC discovery or explicit OAuth endpoints; `generic_api` Connectors
describe a fixed API origin and bearer or fixed-header credential injection.
Both define the maximum HTTP methods and path prefixes that a downstream grant
may use.

External accounts have exactly one user, organization, or Agent owner. The
credential is a separate encrypted record and is never returned through a read
API. OAuth authorization uses authorization code with PKCE, one-time state, and
optional user-info subject discovery. Access and refresh tokens are encrypted;
expired access tokens are refreshed only at the network boundary. Bearer tokens
and fixed-header API keys use the same custody boundary. Passwords, cookies,
browser sessions, query credentials, and custom signing schemes are not
accepted.

`CREDENTIAL_ENCRYPTION_KEY` supplies AES-GCM key material for Connector client
secrets, external credentials, and OAuth PKCE verifiers.
Each envelope uses randomized nonces and purpose-specific authenticated
context.

## Constrained egress

Agents call `/api/agent/egress/{externalAccountId}/{relativePath}` with a DPoP
access token. FlareAuth intersects four independent boundaries before injecting
a credential:

1. the active stable identity and host binding;
2. the active authority grant and token audience/scopes;
3. the active external-account grant;
4. the Connector origin, method, path, and credential mode.

Only public HTTPS origins are accepted. Requests cannot override authorization,
cookies, host, transport headers, or the configured credential header.
Non-canonical paths and redirects are rejected, request and response headers are
allow-listed, and bodies are streamed without entering audit records.

## Governance and audit

Account Center exposes personally owned stable identities, including permanent
retirement. Organization settings expose organization-owned identities.
Console exposes tenant-wide identity inventory, egress decision audit, and
emergency retirement. The unified OpenAPI publishes the same governance
operations for Restish clients.

Every allowed or denied egress decision records controller authority, subject,
Agent identity, host, grants, target origin/path/method, result, and a bounded
reason or upstream status. Credentials, authorization headers, and complete
request or response bodies are excluded.

## Consequences

- There is no schema migration from AgentAuth metadata and no identity stored in
  untrusted Agent metadata.
- A protocol Agent may exist temporarily without a stable identity, but it has
  no identity-level authority until binding succeeds.
- One stable Agent may have multiple active hosts without sharing private keys.
- Connector, external credential, DPoP, egress, and audit designs build on the
  stable identity but remain separate components.
