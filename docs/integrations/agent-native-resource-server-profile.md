# Agent-native Resource Server Profile

Status: **Realmroot Profile 0.1 — implementation baseline**

Last reviewed: **2026-08-08**

This document is the canonical integration profile for an external service that
wants to accept Realmroot Agents directly. It inventories the open standards
Realmroot currently composes, the requirements Realmroot adds to that
composition, and the remaining Realmroot-specific extensions.

This profile is not an RFC and does not claim standards-body consensus. Its
long-term purpose is to converge on open standards that platforms can implement
without Realmroot-specific middleware. The companion
[`realmroot/adapters`](https://github.com/realmroot/adapters) project implements
temporary compatibility for platforms that do not yet satisfy the profile.

## Terminology

| Term | Meaning in this document |
| --- | --- |
| IETF RFC | An RFC document published through the IETF standards process. This profile always cites its exact RFC number and title. |
| IETF Internet-Draft | A proposal still under discussion. It may change, expire, or never become an RFC, so this profile never reports a draft as a published RFC. |
| Open specification | A specification published outside the RFC Series, such as OpenID Connect or OpenAPI. |
| Profile | A versioned selection of standards plus Realmroot's interoperability requirements and constraints. This document is a profile. |
| Extension | A Realmroot-defined wire field, endpoint, representation, or convention that is not currently defined by an adopted external standard. |

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
express Realmroot Profile 0.1 requirements. They do not change the conformance
language of the referenced specifications.

## Conformance classes

An implementation declares one or both classes:

- **Native Resource Server** — the platform trusts a Realmroot-compatible
  issuer and validates Realmroot-issued access tokens at its own API boundary.
- **Federated Platform** — the platform owns its authorization server, issues
  the final access token, and preserves the external Agent as the actor.

Both classes call the platform API directly. An adapter that terminates the
Agent credential and calls the provider with a different credential is a
compatibility bridge, not a conforming platform implementation.

Requirement values in the inventory are:

- **MUST** — required for the named conformance class;
- **COND** — required when the stated feature is used;
- **SHOULD** — expected unless the implementation documents why it is not
  applicable;
- **MAY** — optional interoperability capability;
- **—** — not required for that class.

## Normative capability inventory

Stable capability IDs let provider reports and future conformance tests refer
to requirements without copying their meaning.

`Realmroot 0.1 status` says whether the current Realmroot implementation
produces or consumes that capability. It is not a claim about external-provider
support.

### Resource and API discovery

| ID | Requirement | Specification | Native Resource Server | Federated Platform | Realmroot 0.1 status |
| --- | --- | --- | --- | --- | --- |
| `RESOURCE-HTTPS` | Use an exact HTTPS Resource identifier as the API base URL and token audience. Loopback HTTP is development-only. | Realmroot profile constraint | MUST | MUST | Implemented |
| `RESOURCE-METADATA` | Publish protected-resource metadata for the exact Resource, including `resource` and `scopes_supported`; federated platforms publish exactly one `authorization_servers` issuer. | [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html) | MUST | MUST | Implemented |
| `API-SERVICE-DESC` | Return an RFC 8631 `service-desc` link from the exact Resource URL. | [RFC 8631](https://www.rfc-editor.org/rfc/rfc8631.html) | MUST | MUST | Implemented |
| `API-OPENAPI` | Serve a live OpenAPI 3.x document from the `service-desc` target. Its operation scopes MUST be a subset of RFC 9728 `scopes_supported`. | [OpenAPI Specification](https://spec.openapis.org/oas/latest.html) plus Realmroot profile constraint | MUST | MUST | Implemented |

### Authorization-server discovery and user connection

| ID | Requirement | Specification | Native Resource Server | Federated Platform | Realmroot 0.1 status |
| --- | --- | --- | --- | --- | --- |
| `AS-METADATA` | Publish authorization-server metadata and signing-key information for the exact issuer. | [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html) | — | MUST | Implemented |
| `OIDC-CONNECTION` | Publish OpenID Provider metadata and support UserInfo for the connected controlling user. | [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html) and [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) | — | MUST | Implemented |
| `OAUTH-CODE` | Support the OAuth 2.0 Authorization Code grant. | [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749.html) | — | MUST | Implemented |
| `OAUTH-REFRESH` | Issue refresh tokens and support the OAuth 2.0 refresh-token grant for a connected controlling user. | [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749.html) | — | MUST | Implemented |
| `OAUTH-PKCE` | Require the `S256` PKCE method for the authorization-code flow. | [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html) | — | MUST | Implemented |
| `OAUTH-RESOURCE` | Bind authorization and token requests to the exact Resource with the `resource` parameter. | [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html) | — | MUST | Implemented |
| `CLIENT-REGISTRATION` | Register the OAuth client dynamically when a `registration_endpoint` is advertised; manual preregistration remains valid. | [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591.html) | — | COND | Implemented |
| `CLIENT-MANAGEMENT` | Read and update a dynamically registered client when registration management credentials are issued. | [RFC 7592](https://www.rfc-editor.org/rfc/rfc7592.html) | — | COND | Implemented |

### Stable Agent actor and delegated authority

| ID | Requirement | Specification | Native Resource Server | Federated Platform | Realmroot 0.1 status |
| --- | --- | --- | --- | --- | --- |
| `ACTOR-CHAIN` | Preserve the controlling subject in `sub` and the stable Agent in the JWT `act` claim with exact `iss` and `sub` values. | [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html) plus Realmroot profile constraint | MUST | MUST | Implemented |
| `ACTOR-PROFILE` | Classify the Agent actor with `act.sub_profile: "ai_agent"`; never treat this classification alone as proof of identity or permission. | [OAuth 2.0 Entity Profiles draft-01](https://datatracker.ietf.org/doc/draft-mora-oauth-entity-profiles/01/) and [OAuth Actor Profile draft-00](https://datatracker.ietf.org/doc/draft-mcguinness-oauth-actor-profile/00/) | MUST | MUST | Draft-aligned implementation |
| `ACTOR-NATIVE` | Represent the stable Agent as a distinct non-human actor in the provider's own authorization or identity model and preserve it in provider audit records. A shared App actor or content footer does not satisfy this capability. | Realmroot profile requirement; tracked by [AI Agent Authentication and Authorization draft-02](https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/02/) | MUST | MUST | Implemented by Realmroot-native Resources; provider-dependent |
| `AGENT-DISPLAY` | Resolve safe Agent display metadata using the verified actor identifier, while keeping display data outside authorization decisions. | Realmroot public Agent resource | SHOULD | SHOULD | Implemented |
| `ACTOR-ASSERTION` | Accept a signed Agent assertion at the token endpoint using the JWT bearer grant. | [RFC 7523](https://www.rfc-editor.org/rfc/rfc7523.html) | — | MUST | Implemented |
| `TOKEN-EXCHANGE` | Exchange the connected user's subject token and target-issued Agent actor token, preserving both in the final access token. | [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html) | — | MUST | Implemented |

### Access-token and proof-of-possession security

| ID | Requirement | Specification | Native Resource Server | Federated Platform | Realmroot 0.1 status |
| --- | --- | --- | --- | --- | --- |
| `JWT-ACCESS-TOKEN` | Issue a signed JWT access token with protected-header `typ: at+jwt`, an exact issuer and audience, expiry, client identity, scopes, and confirmation data. | [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html) | MUST | MUST | Implemented |
| `DPOP` | Bind access tokens to the Agent key, require `Authorization: DPoP`, validate a proof for every request, and provide no Bearer fallback. | [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html) | MUST | MUST | Implemented |
| `JWK-THUMBPRINT` | Compute the proof key thumbprint and match it to access-token `cnf.jkt`. | [RFC 7638](https://www.rfc-editor.org/rfc/rfc7638.html) | MUST | MUST | Implemented |

RFC 7515 (JWS), RFC 7517 (JWK), and RFC 7519 (JWT) are transitive data-format
dependencies of the token requirements. Provider reports normally track the
profile capabilities above rather than listing those building blocks as
separate product capabilities.

### Rich authorization and lifecycle

| ID | Requirement | Specification | Native Resource Server | Federated Platform | Realmroot 0.1 status |
| --- | --- | --- | --- | --- | --- |
| `RICH-AUTHORIZATION` | Accept Resource-specific authorization details when the Resource requires structured authority beyond scopes. | [RFC 9396](https://www.rfc-editor.org/rfc/rfc9396.html) | — | COND | Implemented |
| `BROKERED-ACCOUNT-CONNECTION` | Let a native Resource Server broker one provider account connection while retaining provider credentials at the Resource Server boundary. | [Realmroot brokered account-connection extension](#brokered-account-connection-extension) | COND | — | Implemented extension |
| `PUSHED-AUTHORIZATION` | Receive rich authorization details through a pushed authorization request. Realmroot requires PAR whenever RFC 9396 is enabled. | [RFC 9126](https://www.rfc-editor.org/rfc/rfc9126.html) plus Realmroot profile constraint | — | COND | Implemented |
| `AUTHORIZATION-CATALOG` | Let Realmroot enumerate provider-owned authorization-detail templates before consent. | [Realmroot authorization-details catalog extension](#authorization-details-catalog-extension) | — | COND | Implemented extension |
| `TOKEN-REVOCATION` | Accept authenticated access-token and refresh-token revocation and fail subsequent use closed. | [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009.html) | — | MUST | Implemented |
| `LIFECYCLE-SIGNALS` | Expose installation, permission-change, Resource-removal, and revocation signals so cached authority and provider credentials can be invalidated. | Realmroot profile requirement | SHOULD | MUST | Provider-dependent |

## Realmroot-specific extensions

Extensions are compatibility debt, not strategic differentiation. Every
extension must have a narrow purpose, an owner, a replacement direction, and a
removal condition.

### Brokered account-connection extension

A native Resource Server that must bridge to a provider-owned account may add
these members to its RFC 9728 protected-resource metadata:

- `account_connection_modes_supported: ["brokered"]`;
- `account_connection_authorization_endpoint`;
- `account_connection_token_endpoint`;
- `account_connection_revocation_endpoint` (recommended during the 0.1 compatibility window).

Realmroot sends the authorization endpoint a signed JWT request object in the
`request` query parameter. The Resource Server MUST validate its signature from
the Realmroot issuer JWKS, exact `iss`, exact Resource `aud`, expiry, and unique
`jti`. The claims bind the owner, canonical `connection_id`, existing external
subject when reconnecting, Realmroot callback URI, S256 PKCE challenge, scopes,
and RFC 9396 authorization details.

After provider authorization, the Resource Server returns an authorization
code and the original Realmroot `state` to the signed callback URI. Realmroot
exchanges that code with the verifier at the advertised token endpoint. The
response contains the stable external subject, display label, broker reference,
granted scopes, and concrete authorization details; it never contains provider
access or refresh credentials.

When the revocation endpoint is advertised, Realmroot sends it a short-lived
signed JWT request before removing the local Connection. The request binds the
Realmroot issuer, Resource audience, owner, Connection, Resource Authorization,
and opaque broker reference. The Resource Server validates it with the same
issuer JWKS and permanently invalidates the referenced provider credential.
Adapters SHOULD implement this endpoint; a later profile version may require it.

Provider lifecycle changes flow back through the generic Connection Event
resource at `PUT /api/resource-servers/{resourceServerId}/connection-events/{eventId}`. The event
representation contains the opaque `brokerReference`,
`occurredAt`, a positive monotonic `revision`, and one of `authorityChanged`,
`resourcesChanged`, `suspended`, `restored`, or `revoked`. `authorityChanged`
requires complete connection-wide `scopes` and `authorityConstraints` plus its
affected scope/detail pair. `resourcesChanged` and `restored` require complete
`scopes`, `authorizationDetails`, and `authorityConstraints` snapshots.
`suspended` and `revoked` carry only the common event fields. Provider
webhook names and payloads stay inside the
Resource Server; Realmroot accepts only this provider-neutral representation.
An `authorityChanged` event includes `affectedAuthorizationDetails` and
`affectedScopes` together. The details select the changed authority and
`affectedScopes` is its resulting scope set. Optional `scopes` remains the
connection-wide union used to update the Connection record; it cannot authorize
the selected authority. Realmroot therefore revokes grants for that authority
only when their scopes exceed `affectedScopes`, even when an adjacent authority
keeps the same scope in the connection-wide union. Permission expansion preserves
grants already within the resulting authority. The three snapshot fields are
complete replacement context for `resourcesChanged` and `restored`; every
authorization detail must be covered by a constraint selector. Detail
objects are compared recursively, arrays are unordered sets, and scalar values
must match exactly when Realmroot determines whether a grant is a subset.
The same atomic D1 boundary expires pending access requests and revokes active
grants that exceed the resulting authority, then invalidates their leases, so an approval racing the
event cannot recreate stale authority. Full snapshots also atomically revoke or
expire requests, grants, and leases no longer covered by their global scopes,
resources, or authority constraints.
Connection Event receipts remain durable for audit and replay safety. Operators
monitor their row count and D1 footprint; deletion requires an explicit retention
policy longer than the provider's delivery retry and identity-reuse window, and
must not remove recent or unapplied receipts.

The Resource Server registers a confidential Application, receives the
`connection-events:write` Application Permission, and obtains a
resource-bound DPoP access token through the `client_credentials` grant.
Realmroot authenticates the Application and requires its owner Organization to
match the addressed Resource Server owner. An event identity is scoped to its Resource URI: an exact
replay returns `204`, while the same identity with a different representation
returns `409`. Realmroot orders mutations only by the Resource Server's
per-connection `revision`. A higher revision applies even when its provider
occurrence timestamp is earlier, while a lower revision is acknowledged without
mutating state even when its timestamp is later. A different event using the
current revision conflicts because every event must advance that revision. `occurredAt` is retained
as audit metadata for the applied revision. Realmroot immediately
revokes affected active leases, constrains grants to reduced scopes and
authorization details, keeps suspension reversible, and permanently revokes
grants when the Connection is revoked or no safe authority remains.
Representations larger than 64 KiB are rejected before the complete body is
buffered.

The API Resource selects the Provider Connector whose account identity it
represents. Realmroot allows one brokered account-connection authority per
Connector and one Provider Connection per owner and Connector. Connector type
is deliberately outside this extension: social, generic OAuth, and future
Connectors use the same wire contract without provider-specific Realmroot code.

- **Purpose:** keep provider OAuth and installation credentials inside a thin
  compatibility Worker while Realmroot owns the Connection and Agent grants.
- **Owner:** the compatibility Resource Server.
- **Replacement direction:** a standards-body profile for brokered account
  attachment, or provider-native Agent identity and authorization that removes
  the account bridge entirely.
- **Removal condition:** the provider accepts the Realmroot Agent directly and
  supplies every required native identity, authorization, revocation, and audit
  capability without this exchange.

### Authorization-details catalog extension

For RFC 9396 integrations, Realmroot currently recognizes these authorization-
server metadata members as one versioned group:

- `authorization_details_catalog_endpoint`;
- `authorization_details_catalog_scope`;
- `authorization_details_catalog_version` (currently `1`).

RFC 9396 defines how a client sends authorization details, but not how it
enumerates a provider's available project, workspace, account, or other
provider-owned values before consent.

- **Purpose:** enumerate templates from which Realmroot constructs an exact
  authorization-details request.
- **Owner:** Realmroot external Resource authorization.
- **Replacement direction:** a provider-owned Resource catalog or an adopted
  discovery specification for rich-authorization templates.
- **Removal condition:** the values needed for consent can be discovered from
  an open standard or are unnecessary for the provider's authorization model.

## Related Realmroot protocols outside this profile

Realmroot also uses RFC 8628 Device Authorization for eligible public clients
and Realmroot-specific `interactive-resource` and `resource-credential-offer`
representations in its management API and Agent tooling. They govern how an
Agent obtains Realmroot authority; an external Resource Server does not
implement them, so they are intentionally excluded from provider conformance
and adapter-retirement decisions.

## Versioning and change policy

- The profile version covers Realmroot constraints and extension contracts;
  referenced standards retain their own versions and status.
- A new mandatory capability or incompatible extension change requires a new
  profile version and migration plan.
- An Internet-Draft revision is reviewed before Realmroot claims alignment; a
  draft name never silently becomes an RFC claim.
