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
| `PUSHED-AUTHORIZATION` | Receive rich authorization details through a pushed authorization request. Realmroot requires PAR whenever RFC 9396 is enabled. | [RFC 9126](https://www.rfc-editor.org/rfc/rfc9126.html) plus Realmroot profile constraint | — | COND | Implemented |
| `AUTHORIZATION-CATALOG` | Let Realmroot enumerate provider-owned authorization-detail templates before consent. | [Realmroot authorization-details catalog extension](#authorization-details-catalog-extension) | — | COND | Implemented extension |
| `TOKEN-REVOCATION` | Accept authenticated access-token and refresh-token revocation and fail subsequent use closed. | [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009.html) | — | MUST | Implemented |
| `LIFECYCLE-SIGNALS` | Expose installation, permission-change, Resource-removal, and revocation signals so cached authority and provider credentials can be invalidated. | Realmroot profile requirement | SHOULD | MUST | Provider-dependent |

## Compatibility Adapter boundary

A provider compatibility Adapter implements the Federated Platform class at
the Adapter boundary. It publishes a standard OAuth/OIDC authorization server
and protected Resource, owns provider credentials and lifecycle state, and
issues the final DPoP token consumed by the Agent. It is not a third
authorization class.

Compatibility Adapters follow External Authorization as defined in the
[Resource Server integration guide](resource-servers.md) and the normative
[Provider Adapter Boundary](../architecture/provider-adapter-boundary.md).

## Realmroot-specific extensions

Extensions are compatibility debt, not strategic differentiation. Every
extension must have a narrow purpose, an owner, a replacement direction, and a
removal condition.

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
