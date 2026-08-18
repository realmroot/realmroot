# Realmroot Resource Server Integration Requirements

Use this reference as the conformance checklist for an existing protected API.
Do not use it to design the API's business resources, routes, representations,
or scope vocabulary.

## Classification

- **REQUIRED** — the selected integration mode cannot be enabled without it.
- **CONDITIONAL** — required when the integration selects the named capability
  or condition.
- **RECOMMENDED** — improves lifecycle, display, or operational behavior but is
  not a prerequisite for base protocol conformance.

## Shared Requirements

These requirements apply to native and external Resource Servers.

| ID | Level | Requirement |
| --- | --- | --- |
| `RESOURCE-HTTPS` | REQUIRED | Use one exact HTTPS protected resource URL as API base URL, OAuth resource indicator, and token audience. Permit HTTP only for explicit loopback development. |
| `RESOURCE-METADATA` | REQUIRED | Publish RFC 9728 metadata for the exact URL with matching `resource` and non-empty `scopes_supported`. External mode also publishes exactly one `authorization_servers` issuer. |
| `API-SERVICE-DESC` | REQUIRED | Return a successful unauthenticated response from the exact resource URL with an RFC 8631 `service-desc` link. |
| `API-OPENAPI` | REQUIRED | Serve a live OpenAPI 3.x document from that link. Declare OAuth/OIDC scopes for operations exposed to Agents, and keep every declared scope within RFC 9728 `scopes_supported`. |
| `AGENT-SKILLS-DISCOVERY` | RECOMMENDED | Publish an Agent Skills Discovery v0.2.0 index at `/.well-known/agent-skills/index.json` on the Resource Server origin, with a skill that teaches Agents how to use the service through Realmroot Toolbox. |
| `ACTOR-CHAIN` | REQUIRED | Preserve the controlling subject and stable Agent as distinct identities in the issued authority and audit boundary. |
| `ACTOR-PROFILE` | REQUIRED | Classify a verified `act` actor as an Agent from the selected Realmroot Agent-token profile and trusted issuer. Do not require the retired `act.sub_profile` compatibility member. |
| `ACTOR-NATIVE` | REQUIRED | Represent the stable Agent as a distinct non-human actor in authorization and audit records; a shared application actor or content footer is insufficient. |
| `JWT-ACCESS-TOKEN` | REQUIRED | Use signed `at+jwt` access tokens with exact issuer and audience, expiry, client identity, scopes, and confirmation data. |
| `DPOP` | REQUIRED | Bind each access token to the Agent key, require `Authorization: DPoP`, validate a fresh proof for every request, and provide no Bearer fallback. |
| `JWK-THUMBPRINT` | REQUIRED | Match the DPoP proof key's RFC 7638 thumbprint to access-token `cnf.jkt`. |
| `AGENT-DISPLAY` | RECOMMENDED | Resolve display metadata from the verified actor identifier while keeping it outside authorization decisions. |

The Resource Server must fail closed for unavailable discovery, invalid issuer
or audience, expired or malformed tokens, insufficient scopes, invalid DPoP
binding, stale or replayed proofs, and denied local business authority.

## Native Mode

Use native mode when Realmroot is the authorization server. Trust only the
explicitly selected Realmroot issuer discovered from:

```text
REALMROOT_ORIGIN/api/auth/.well-known/openid-configuration
```

Validate the Realmroot-signed access token before using any claims. Require the
operation's existing scopes, validate `act.iss` and `act.sub`, and validate proof type, algorithm,
signature, method, effective URI, freshness, unique `jti`, `ath`, and
`cnf.jkt`. Enforce local ownership and business policy after cryptographic
validation.

| ID | Level | Requirement |
| --- | --- | --- |
| `LIFECYCLE-SIGNALS` | RECOMMENDED | Expose installation, permission-change, Resource-removal, and revocation signals so cached authority can be invalidated promptly. |
| `BROKERED-ACCOUNT-CONNECTION` | CONDITIONAL | When the native API retains another provider's credential, implement Realmroot's signed account-connection flow and keep provider credentials behind the Resource Server boundary. |
| `BROKERED-REVOCATION` | RECOMMENDED | When brokered connection is enabled, expose its revocation endpoint and permanently invalidate the referenced provider credential. |

Brokered account connection does not turn a native Resource Server into an
external authorization server.

## External Mode

External mode is a federated-platform integration. The provider owns its users,
authorization server, signing keys, consent, grants, provider credentials, and
target access-token lifecycle.

| ID | Level | Requirement |
| --- | --- | --- |
| `AS-METADATA` | REQUIRED | Publish RFC 8414 authorization-server metadata and signing-key information for the exact issuer advertised by RFC 9728 metadata. |
| `OIDC-CONNECTION` | REQUIRED | Publish OpenID Provider metadata and support UserInfo for the connected controlling user. |
| `OAUTH-CODE` | REQUIRED | Support the authorization-code grant for controller account connection. |
| `OAUTH-REFRESH` | REQUIRED | Issue refresh tokens and support refresh for the connected controlling user. |
| `OAUTH-PKCE` | REQUIRED | Require S256 PKCE for authorization code. |
| `OAUTH-RESOURCE` | REQUIRED | Bind authorization and token requests to the exact protected resource with RFC 8707 `resource`. |
| `ACTOR-ASSERTION` | REQUIRED | Accept the signed Agent assertion at the token endpoint using the JWT bearer grant. |
| `TOKEN-EXCHANGE` | REQUIRED | Exchange the connected user's subject token and target-issued Agent actor token while preserving both identities in the final token. |
| `TOKEN-REVOCATION` | REQUIRED | Accept authenticated RFC 7009 revocation and fail subsequent access or refresh use closed. |
| `LIFECYCLE-SIGNALS` | REQUIRED | Invalidate cached authority and provider credentials for installation, permission, Resource, connection, Agent, host, or grant lifecycle changes. |
| `CLIENT-REGISTRATION` | CONDITIONAL | Support RFC 7591 when the authorization-server metadata advertises `registration_endpoint`; otherwise manually preregister the Realmroot client. |
| `CLIENT-MANAGEMENT` | CONDITIONAL | Support RFC 7592 read and update when dynamic registration returns management credentials. |
| `RICH-AUTHORIZATION` | CONDITIONAL | Support RFC 9396 when scopes cannot express the selected provider-owned context. |
| `PUSHED-AUTHORIZATION` | CONDITIONAL | Support RFC 9126 PAR whenever RFC 9396 rich authorization is enabled. |
| `AUTHORIZATION-CATALOG` | CONDITIONAL | Publish the versioned Realmroot catalog extension when Realmroot must enumerate authorization-detail templates before consent. |

Realmroot must receive no manually copied provider access or refresh tokens and
must not proxy business API traffic.

## Evidence And Acceptance

For each applicable capability, record direct evidence from one or more of:

- live RFC 9728, RFC 8414, OIDC, or JWKS metadata;
- the live OpenAPI document;
- implementation code at the enforcement boundary;
- focused automated tests;
- a real Realmroot Agent operation.

At minimum verify:

- exact resource URL, metadata, OpenAPI link, and scope consistency;
- exact issuer and audience acceptance and rejection;
- expired, malformed, unsigned, and wrong-algorithm tokens;
- missing, mismatched, stale, and replayed DPoP proofs;
- missing and insufficient scopes;
- valid credentials denied by local business authority;
- one valid read and one safe write when the API exposes one;
- every selected external or brokered connection, refresh, exchange, and
  revocation boundary.
