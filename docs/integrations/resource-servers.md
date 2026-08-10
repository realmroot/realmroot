# Resource Server Integration

This guide is for teams exposing a protected API through Realmroot. It covers
what the resource server must publish and validate in both authorization modes:

- `native`: Realmroot issues the API access token.
- `external`: the target platform owns its authorization server and issues the
  API access token.

Realmroot never proxies business API requests. After authorization, the client
calls the registered resource URL directly with a DPoP-bound access token.

The normative capability inventory and extension lifecycle live in the
[Agent-native Resource Server Profile](agent-native-resource-server-profile.md).
This guide explains how to implement that profile with Realmroot.

## Shared Resource Contract

Both modes register one protected resource URL:

| Value | Meaning |
| --- | --- |
| `resourceUrl` | HTTPS resource identifier placed in the access token's `aud` claim, called by the client, and used to discover the API contract. |

Production URLs must use HTTPS and contain no username or password. Plain HTTP
is accepted only for loopback development URLs.

### Publish Protected Resource Metadata

Both authorization modes publish RFC 9728 metadata at the well-known URL
derived from the exact `resourceUrl`. `scopes_supported` is Realmroot's
authoritative list of requestable scopes:

```json
{
  "resource": "https://api.example.com/v1",
  "scopes_supported": ["projects:read", "projects:write"]
}
```

The `resource` value must exactly match the configured `resourceUrl`. External
authorization also includes exactly one `authorization_servers` issuer.

### Advertise OpenAPI

An unauthenticated `GET` to the exact `resourceUrl` must return a successful
response with an RFC 8631 `service-desc` link:

```http
HTTP/1.1 200 OK
Link: <https://api.example.com/openapi.json>; rel="service-desc"; type="application/openapi+json"
Content-Type: application/json
```

Relative link targets are allowed. The linked document must be OpenAPI 3.x in
JSON or YAML.

OpenAPI may supply descriptions for advertised scopes through an OAuth 2.0
flow and may map protected operations to those scopes through standard
`security` requirements:

```yaml
openapi: 3.1.0
info:
  title: Projects API
  version: 1.0.0
servers:
  - url: https://api.example.com
components:
  securitySchemes:
    resourceOidc:
      type: openIdConnect
      openIdConnectUrl: https://auth.example.com/api/auth/.well-known/openid-configuration
paths:
  /projects:
    get:
      operationId: listProjects
      security:
        - resourceOidc: [projects:read]
      responses:
        "200":
          description: Projects visible to the caller
```

Document-level `security` is also supported. An advertised scope remains
requestable even when OpenAPI provides no description or public operation
mapping. An OpenAPI operation cannot reference a scope absent from RFC 9728
`scopes_supported`.

An enabled Resource Server whose contract is temporarily unavailable remains visible
to Agents with `availability.status: unavailable` and no requestable scopes; it does not
block discovery of other resources. Access requests and token issuance still
fail closed because Realmroot revalidates the selected resource contract. An
administrator may save an unreachable resource only as a disabled draft.

## Native Authorization

Use native mode when the product already uses Realmroot as its authorization
server and the protected API can trust the Realmroot issuer.

### Register The Resource

Create an API Resource with:

| Field | Value |
| --- | --- |
| `connectorId` | Omit this field. |
| `resourceUrl` | The protected API identifier and base URL that the API accepts as its audience and that advertises OpenAPI. |
| `enabled` | Enable after discovery and token validation are configured. |

No target OAuth client, target authorization-server metadata, or external
account connection is used.

A representative Resource API body is:

```json
{
  "identifier": "projects-api",
  "name": "Projects API",
  "resourceUrl": "https://api.example.com",
  "enabled": true
}
```

The live `/api/openapi.json` contract is authoritative for the current request
schema if the resource is created through automation.

### Validate Realmroot Tokens

Discover the issuer metadata rather than hard-coding protocol endpoints:

```text
Issuer:         REALMROOT_ORIGIN/api/auth
OIDC discovery: REALMROOT_ORIGIN/api/auth/.well-known/openid-configuration
JWKS:           REALMROOT_ORIGIN/api/auth/jwks
Public profile: REALMROOT_ORIGIN/api/public/agents/{subject}
```

Agent configuration and OAuth authorization-server metadata publish that
template as `agent_profile_uri_template`. Replace `{subject}` with the
URL-encoded, verified `act.sub` value.

For every protected request, require both headers:

```http
Authorization: DPoP ACCESS_TOKEN
DPoP: DPOP_PROOF_JWT
```

Validate the access token before using any claims:

1. Require a signed JWT with protected-header `typ` equal to `at+jwt`.
2. Accept only an explicitly configured signing algorithm published by the
   Realmroot JWKS.
3. Require `iss` to equal the Realmroot issuer exactly.
4. Require `aud` to contain the registered resource audience exactly.
5. Validate `exp`, `iat`, and the JWT signature.
6. Require the scopes needed by the selected OpenAPI operation.
7. Require `cnf.jkt`; it binds the token to the DPoP public key.

Native Agent tokens may also contain:

- `sub`: the controlling user or organization;
- `client_id`: the presenting AgentAuth registration;
- `act`: the stable Agent's `iss`, `sub`, and `sub_profile: ai_agent`;
- `roles`: effective roles for this API Resource;
- `groups`: the Agent's organization home space.

Treat `scope` as the granted API authority. `roles`, `groups`, `sub`, and `act`
provide policy and audit context; they do not expand the token's scopes.

### Resolve Optional Agent Display Information

Display clients may query Realmroot's public Agent resource with the verified
Agent actor subject:

```http
GET REALMROOT_ORIGIN/api/public/agents/ACT_SUB
Accept: application/json
```

Agents without a custom picture return Realmroot's versioned static placeholder
(`/agent-picture-v1.svg`) in the `picture` field, so clients can always render a
valid image URL without calling another API.

Require the response `issuer` and `subject` to exactly match the verified
`(act.iss, act.sub)` pair before displaying `name` or `picture`. Cache the
response according to its `Cache-Control` and `ETag` headers.

The public profile is display metadata. Never use its availability, name,
picture, or update time to authorize a request; continue to enforce the
validated access token, scope, audience, DPoP binding, and local policy.

### Validate The DPoP Proof

Validate the proof independently on every request:

1. Require protected-header `typ: dpop+jwt`, a public `jwk`, and an allowed
   asymmetric `alg`.
2. Verify the proof signature with that embedded public key.
3. Require `htm` to equal the actual HTTP method.
4. Require `htu` to equal the effective target URI according to RFC 9449.
5. Require a recent `iat` and a unique `jti`; retain enough replay state to
   reject reuse during the accepted time window.
6. Calculate the RFC 7638 thumbprint of the proof JWK and compare it with the
   access token's `cnf.jkt`.
7. Calculate the base64url SHA-256 hash of the serialized access token and
   compare it with the proof's `ath`.

Reject a missing or invalid token/proof with `401` and a DPoP
`WWW-Authenticate` challenge. Do not fall back to Bearer authentication.

### Native Request Flow

```text
Agent plugin -> Realmroot: accept approved access request's credential offer + DPoP proof
Realmroot -> Agent: short-lived Realmroot-signed DPoP access token
Agent -> Resource API: Authorization: DPoP ... + request DPoP proof
Resource API: validate JWT, scopes, cnf.jkt, proof target, ath, and replay state
```

## Brokered Native Account Connection

Use this transitional mode when the API can validate Realmroot-issued native
tokens but must keep a provider OAuth or installation credential behind its own
boundary. It is a Realmroot extension, not an adopted RFC. The Resource Server
remains native for token validation, but its API Resource MUST select the
Provider Connector whose account identity it represents. The Connector is the
stable provider key used to enforce one user-visible Connection; it does not
turn this Resource Server into an external OAuth authorization server.
Realmroot never stores the provider credential.

Advertise the connection endpoints with the RFC 9728 metadata. The revocation
endpoint is recommended during the 0.1 compatibility window:

```json
{
  "resource": "https://adapter.example.com/github",
  "scopes_supported": ["metadata:read", "issues:write"],
  "account_connection_modes_supported": ["brokered"],
  "account_connection_authorization_endpoint": "https://adapter.example.com/github/account-connection-authorizations",
  "account_connection_token_endpoint": "https://adapter.example.com/github/account-connection-credentials",
  "account_connection_revocation_endpoint": "https://adapter.example.com/github/account-connection-revocations"
}
```

Realmroot calls the authorization endpoint with `request=SIGNED_JWT`. Validate
the request against Realmroot's published JWKS and require exact issuer,
Resource audience, expiry, and one-use `jti`. The signed claims bind:

- the owner and canonical `connection_id`;
- `expected_external_subject` during same-account reconnection;
- Realmroot's callback URI and state;
- an S256 PKCE challenge;
- requested scopes and RFC 9396 authorization details.

After the provider flow, redirect the browser to the signed callback URI with
`code` and `state`. Realmroot exchanges the one-use code and `code_verifier` at
the token endpoint. Return only connection metadata:

```json
{
  "external_subject": "8208",
  "display_name": "Jasper Van",
  "broker_reference": "connection-opaque-id",
  "scope": "metadata:read issues:write",
  "authorization_details": [
    { "type": "github_installation", "installation_id": "152097080" }
  ]
}
```

One owner has at most one Connection for a Provider Connector. Each connected
Resource Server receives its own Resource Authorization beneath that
Connection. A Connector may have exactly one brokered account-connection
authority, so Account Center never has to choose among Adapter-specific entry
points. The Resource Server resolves the context only from Realmroot-signed
`connection_id` and `authorization_details` claims;
callers cannot select a provider account or installation through the request
URL. Reauthorization may update that Connection only for the same external
subject. Realmroot stores no provider token and deactivating the Connection
immediately prevents new target tokens.

When `account_connection_revocation_endpoint` is advertised, Realmroot first
posts a short-lived signed JWT as the form field `request`. Validate the same
issuer, Resource audience, expiry, and one-use `jti` rules, then invalidate the
bound `broker_reference`. Return a successful 2xx response only after the
provider credential can no longer be used.

### Connection Event backchannel

Brokered Resource Servers translate provider lifecycle notifications into
provider-neutral Connection Event resources:

```http
PUT /api/resource-servers/ars_example/connection-events/delivery-018f4f92
Authorization: DPoP <application-access-token>
DPoP: <request-proof>
Content-Type: application/json

{
  "type": "authorityChanged",
  "brokerReference": "connection-opaque-id",
  "occurredAt": "2026-08-08T20:00:00.000Z",
  "revision": 42,
  "scopes": ["items:read", "items:write"],
  "affectedScopes": ["items:read"],
  "affectedAuthorizationDetails": [
    { "type": "provider_resource", "resource_id": "resource-1" }
  ],
  "authorityConstraints": [
    {
      "authorizationDetails": [
        { "type": "provider_resource", "resource_id": "resource-1" }
      ],
      "scopes": ["items:read"]
    }
  ]
}
```

The five event types are `authorityChanged`, `resourcesChanged`, `suspended`,
`restored`, and `revoked`. Their payloads are disjoint:
`authorityChanged` requires complete connection-wide `scopes` and
`authorityConstraints` plus `affectedScopes` and `affectedAuthorizationDetails`.
`resourcesChanged` and `restored` require complete `scopes`,
`authorizationDetails`, and `authorityConstraints` snapshots. `suspended` and
`revoked` carry only the common event fields. The publisher is a confidential
Application with the `client_credentials` grant, a configured
`connection-events:write` scope on the Realmroot Resource Server, and the
matching Application Permission. It requests a Realmroot API audience token
and sends the RFC 9449 DPoP-bound credential. Realmroot authenticates the
Application, checks its scope and Resource Server owner boundary, and scopes
replay identity to `(resource, eventId)`. A
successful first application or exact replay returns `204`; conflicting reuse
returns `409`. `revision` is a required positive integer that the Resource
Server increases for each provider connection. Realmroot orders events by the
per-connection `revision` only: a higher revision applies even with an earlier
`occurredAt`, while a lower revision is acknowledged without changing state
even with a later `occurredAt`. A different event using the current revision
conflicts because each event must increase the connection revision. The occurrence
time is audit metadata for the applied revision. Never forward provider webhook event names or provider-specific
top-level fields into this protocol. Provider-specific resource selectors may
remain within RFC 9396 `authorizationDetails`.

Connection Event receipts are durable audit and replay-safety records, not a
transient request cache. Realmroot does not delete them automatically because a
removed `(resource, eventId)` receipt would make an old delivery identity usable
again. Operators should monitor receipt row count and D1 storage growth as part
of capacity planning. Introduce retention or archival only with an explicit
provider delivery-ID reuse guarantee and a window longer than every provider
retry and audit requirement; never prune unapplied or recent receipts merely to
recover space.

For `authorityChanged`, `affectedAuthorizationDetails` and `affectedScopes` are
required together. The details identify only the generic authority whose scopes
changed, and `affectedScopes` is that authority's resulting scope set. The
`scopes` remains the resulting connection-wide union and updates
the Connection record; it is never used as the affected authority's scope set.
Realmroot atomically revokes matching pending requests, grants, and leases only
when their scopes exceed `affectedScopes`, so an adjacent authority retaining the
same scope cannot keep an affected grant alive through the connection-wide union.
Permission or resource additions preserve grants that remain subsets. Object
members are compared recursively, arrays are treated as unordered sets, and
scalars must match exactly. For
`resourcesChanged` and `restored`, `scopes`, `authorizationDetails`, and
`authorityConstraints` form the complete replacement connection context.
Realmroot atomically expires or revokes requests, grants, and leases no longer
covered by that snapshot. Every snapshot authorization detail must be covered
by at least one constraint selector. Event bodies are limited to 64 KiB.

## External Authorization

Use external mode when the target platform owns its users, OAuth client
registry, authorization server, signing keys, and access-token lifecycle.
Realmroot acts as a standards-based OAuth client; the final access token is
issued and validated entirely by the target platform.

First create a standard OIDC Connector for the target authorization server.
Select dynamic registration when the target publishes `registration_endpoint`,
or supply the pre-registered `clientId` and `clientSecret` for manual mode.
Then register the API Resource and select that Connector:

```json
{
  "identifier": "external-projects-api",
  "name": "External Projects API",
  "resourceUrl": "https://api.example.com/v1",
  "connectorId": "idp_target"
}
```

For a Resource Server that does not advertise the brokered account-connection
extension, the presence of `connectorId` makes the resource externally
authorized. Its authorization mode cannot change after creation, although it
may switch to another compatible OIDC Connector.

### Bind Protected Resource Metadata To The Authorization Server

For resource URL `https://api.example.com/v1`, Realmroot fetches:

```text
https://api.example.com/.well-known/oauth-protected-resource/v1
```

For external authorization, publish the shared RFC 9728 scope metadata with
exactly one authorization server:

```json
{
  "resource": "https://api.example.com/v1",
  "authorization_servers": ["https://accounts.example.com"],
  "scopes_supported": ["projects:read", "projects:write"]
}
```

### Publish Authorization Server Metadata

Realmroot fetches RFC 8414 metadata using issuer-path insertion. For issuer
`https://accounts.example.com/oauth`, the URL is:

```text
https://accounts.example.com/.well-known/oauth-authorization-server/oauth
```

The metadata must contain:

```json
{
  "issuer": "https://accounts.example.com",
  "authorization_endpoint": "https://accounts.example.com/authorize",
  "token_endpoint": "https://accounts.example.com/token",
  "registration_endpoint": "https://accounts.example.com/register",
  "revocation_endpoint": "https://accounts.example.com/revoke",
  "jwks_uri": "https://accounts.example.com/jwks",
  "userinfo_endpoint": "https://accounts.example.com/userinfo",
  "grant_types_supported": [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
    "urn:ietf:params:oauth:grant-type:token-exchange"
  ],
  "code_challenge_methods_supported": ["S256"],
  "dpop_signing_alg_values_supported": ["ES256"]
}
```

`issuer` must exactly match the issuer advertised by the protected resource.
All listed endpoint URLs are required except `registration_endpoint`, which may
be omitted when Realmroot is configured with a manually registered client.

### Register The Realmroot OAuth Client

Dynamic registration uses RFC 7591. Realmroot submits a confidential client
whose relevant metadata is:

```json
{
  "client_name": "Realmroot External API Resource",
  "redirect_uris": [
    "https://realmroot.example.com/oauth/account-connection/callback"
  ],
  "grant_types": [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
    "urn:ietf:params:oauth:grant-type:token-exchange"
  ],
  "response_types": ["code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "scope": "openid offline_access",
  "jwks_uri": "https://realmroot.example.com/api/auth/jwks"
}
```

Return `client_id` and `client_secret`. A
`registration_access_token` is optional.

For manual registration, create the same client at the target platform and
configure its `client_id` and `client_secret` in Realmroot. The redirect URI and
`jwks_uri` must use Realmroot's stable canonical production origin.

### Support Target Account Connection

Realmroot starts authorization code with S256 PKCE using:

- `resource`: the registered resource URL;
- `scope`: the connection scope set plus `openid offline_access`;
- the canonical Realmroot redirect URI;
- `state`, `code_challenge`, and `code_challenge_method=S256`.

One personal or organization home space can have only one connected account for
an API Resource. When connection starts from a pending Agent approval,
Realmroot requests the resource's complete current Agent-delegable RFC 9728
scope catalog for the account connection; the later Agent grant remains limited
to the exact scopes displayed in that approval. Authorization-server
`scopes_supported` metadata is not used as the resource scope catalog.

The token endpoint must authenticate the client with
`client_secret_basic`, validate the code and verifier, and return
`access_token`, `refresh_token`, `expires_in`, and the granted `scope`.
Refresh-token requests must return a current subject access token.

Realmroot calls `userinfo_endpoint` with the subject access token. The response
must contain `sub`; `name` or `preferred_username` may provide a display label.
The refresh credential is encrypted by Realmroot and is never given to the
Agent.

If an existing connection does not cover a pending Agent request, the hosted
approval blocks the Agent decision and asks the controller to expand the target
account authorization first. Returning with the same external subject preserves
the connection ID and replaces its encrypted credentials, granted scopes,
display name, and expiry while restoring active status. Returning with a
different subject is rejected until the existing account is disconnected.
After OAuth, the controller returns to the pending request and decides the
Agent scopes and lifetime separately.

### Support Rich Authorization And Resource Contexts

An external resource may use RFC 9396 authorization details in addition to
its advertised scopes. Configure the API Resource with opaque authorization-detail
templates whose `type` values appear in the authorization server's
`authorization_details_types_supported` metadata. Realmroot sends those
templates through an RFC 9126 pushed authorization request when connecting the
controller's provider account and stores the concrete details returned by the
target token endpoint.

An Agent access request may contain one or more concrete authorization details.
Realmroot preserves the complete array through approval, grant storage, token
exchange, refresh, revocation, and audit projection. Realmroot does not impose a
single-detail policy; a Resource Server that requires one context per token
must enforce that rule in its own authorization server.

RFC 9396 does not define how a client enumerates available projects,
repositories, workspaces, or other provider-owned contexts. Resource Servers
may therefore implement Realmroot's optional, business-neutral authorization
detail catalog extension. Advertise all three metadata members together:

```json
{
  "authorization_details_catalog_endpoint": "https://accounts.example.com/authorization-details",
  "authorization_details_catalog_scope": "authorization-details:read",
  "authorization_details_catalog_version": 1
}
```

Version 1 defines an account-authorized paginated `GET`. The endpoint receives
`limit` and `offset` query parameters, authenticates the connected subject's
Bearer access token, and requires the advertised catalog scope. It returns:

```json
{
  "items": [
    {
      "authorizationDetail": {
        "type": "https://api.example.com/authorization-details/project",
        "identifier": "project_123"
      },
      "display": {
        "label": "Release Project",
        "description": "Optional controller-facing description",
        "metadata": { "region": "ca-central-1" }
      }
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 1,
    "hasMore": false,
    "nextOffset": null
  }
}
```

`authorizationDetail` is opaque JSON except for its required non-empty `type`.
Display fields never grant authority. Realmroot validates every returned detail
against the API Resource templates and decorates the page with connected-account
and active-Agent-grant state. A resource using RFC 9396 does not have to
implement this catalog; without it, Agents can select exact details already
exposed by their connected account.

### Support Agent And Token Exchange Grants

Realmroot first requests the Agent actor token using RFC 7523:

```text
grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
assertion=SIGNED_AGENT_ASSERTION
```

Validate the assertion against the OAuth client's registered `jwks_uri`.
Require its signature, expiry, unique `jti`, and:

- `aud`: the target token endpoint;
- `iss`: the stable Realmroot issuer;
- `sub`: the stable Agent subject.

Issue a short-lived actor access token bound to that OAuth client and Agent.

Realmroot then sends RFC 8693 token exchange with client authentication and a
token-endpoint DPoP proof:

```text
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=CONNECTED_USER_ACCESS_TOKEN
subject_token_type=urn:ietf:params:oauth:token-type:access_token
actor_token=AGENT_ACTOR_ACCESS_TOKEN
actor_token_type=urn:ietf:params:oauth:token-type:access_token
requested_token_type=urn:ietf:params:oauth:token-type:access_token
resource=REGISTERED_AUDIENCE
scope=EXACT_APPROVED_SCOPE_SET
```

The target authorization server must:

1. validate the subject and actor tokens;
2. verify that the actor token belongs to the authenticated OAuth client;
3. restrict the result to the intersection of the connected user's scopes and
   the requested Agent scopes;
4. validate the RFC 9449 proof for the token endpoint;
5. issue a short-lived token with `token_type: DPoP`;
6. bind the token to the proof key with `cnf.jkt`;
7. identify the connected user as `sub` and the stable Agent in `act.sub`;
8. return exactly the requested scope set.

Realmroot rejects a response with a different scope set or a non-DPoP token
type. It limits its recorded token lease to at most one hour even if the target
returns a longer `expires_in`.

### Validate External API Requests

The external resource server validates the final target-issued token and DPoP
proof using the same DPoP checks described for native mode. The token issuer and
JWKS are the target platform's, not Realmroot's. Require:

- the target authorization-server issuer;
- the registered resource URL as audience;
- the required operation scopes;
- the target token's signature and expiry;
- `cnf.jkt`, proof `htu`/`htm`/`jti`, and `ath`.

Realmroot never appears in the business API request path.

### Support Revocation

The revocation endpoint must accept RFC 7009 requests authenticated with the
Realmroot OAuth client. Realmroot sends the active target access token with
`token_type_hint=access_token` when a grant, connection, credential, Agent, or
host revocation invalidates a token lease.

## Integration Checklist

Before enabling a resource:

- The exact resource URL returns a `service-desc` OpenAPI link.
- The RFC 9728 metadata resource value exactly matches the configured URL and
  advertises non-empty `scopes_supported`.
- OpenAPI is 3.x and protected operations declare OAuth/OIDC security scopes.
- Realmroot can fetch the resource URL and linked contract without a user
  session.
- The configured resource URL matches the resource server's audience validation.
- The resource rejects Bearer fallback and validates DPoP replay and `ath`.
- Native mode trusts only the configured Realmroot issuer and JWKS.
- External mode publishes matching RFC 9728 and RFC 8414 metadata.
- External authorization supports PKCE, refresh, JWT bearer, token exchange,
  DPoP, UserInfo, and revocation.
- RFC 9396 resources support PAR and return the exact authorization details;
  the optional Realmroot catalog extension is versioned and paginated.
- External client redirect and JWKS URLs use Realmroot's stable canonical
  origin.

Run the repository's
[native resource server](../../examples/native-resource-server/README.md) or
[external resource server](../../examples/external-resource-server/README.md)
to inspect one mode end to end.
