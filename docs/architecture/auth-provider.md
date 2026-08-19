# Auth Provider Architecture

Realmroot uses Better Auth's OAuth Provider as the OAuth 2.1 and OpenID Connect
foundation. One deployment owns one issuer, user pool, client registry, consent
store, signing-key lifecycle, and security policy.

## Protocol Boundary

The issuer is the mounted Better Auth path, not the site origin:

```text
AUTH_ORIGIN/api/auth
```

Protocol metadata is available at:

```text
OIDC discovery: /api/auth/.well-known/openid-configuration
OAuth metadata:  /.well-known/oauth-authorization-server/api/auth
JWKS:            /api/auth/jwks
```

Interactive and token endpoints remain below `/api/auth/oauth2/*`. Product
applications integrate through standard discovery and do not use the Realmroot
Resource API for sign-in or session handling.

Realmroot configures Better Auth with remotely verifiable JWT support and RS256
as the active ID-token signing algorithm. Superseded signing keys remain in
JWKS during the configured grace period so existing tokens survive a safe key
rollover.

## Client Model

OAuth clients are first-class `oauth_client` records:

- public browser, native, and CLI clients use authorization code with PKCE S256,
  `token_endpoint_auth_method: none`, and no client secret;
- confidential server-side clients authenticate with
  `client_secret_basic` or `client_secret_post`;
- refresh credentials require `offline_access`;
- `skipConsent` is reserved for trusted first-party clients;
- dynamic client registration is disabled for ordinary product clients.

Public clients may be configured for the RFC 8628 device authorization grant.
The hosted browser performs user approval; polling returns the same provider
token material as other OAuth grants.

Client configuration and operating commands belong to the Realmroot skill.
Consumers should derive endpoints from discovery rather than copying them from
examples.

## Token Model

OAuth access tokens issued for a registered API Resource audience are signed
JWTs following the RFC 9068 profile. Refresh tokens remain opaque, are stored
hashed, and rotate.

Common JWT claims include:

- `iss`: `AUTH_ORIGIN/api/auth`;
- `aud`: the provider or registered API Resource audience;
- `sub`: the user for user grants;
- `client_id`: the OAuth client ID;
- `scope`: the granted scope string;
- `sid`: the user session when applicable.

For a private Application, Realmroot adds the owner Organization ID as the
string claim `urn:realmroot:params:oauth:org`. When `groups` is granted,
`groups` contains only the user's Team names in that Organization. Access
tokens retain effective Resource `roles` and approved scopes; ID tokens never
contain Resource roles or scopes. A public Application does not inherit its
owner's Organization or Teams for an external user. The access token does not duplicate these values under an
`authorization` object and does not emit `azp`, `application_id`, or a
top-level `organization_id`. Stored legacy per-Application claim selections no
longer alter issuance.

Better Auth Organization Roles map human memberships to scopes within exactly
one Organization. Agents, Applications, and workloads do not receive Roles;
their consent, grant, or token exchange determines the exact tenant-bound scope
set directly.

See [Authorization boundaries](authorization-boundaries.md) for scope ownership,
Organization Role mapping, issuance policy, and resource-server enforcement.

## Native Agent Tokens

Native API Resource tokens use the same issuer, JWKS, and key lifecycle as
product OAuth tokens. They are five-minute `at+jwt` access tokens containing:

- the Agent's personal-owner user ID or organization home-space ID as `sub`;
- the stable Agent as the RFC 8693 `act` actor with exact `iss` and `sub`;
- `client_id: realmroot-cli`, the reserved Realmroot Agent protocol client
  identifier; it is not an Application or persisted OAuth client;
- the exact approved `scope`;
- applicable Organization `roles` and `groups` for human tokens; Agent tokens
  rely on the exact approved scope instead;
- the DPoP key thumbprint in `cnf.jkt`.

The Host remains internal AgentAuth credential, binding, revocation, and audit
context. The protected API validates both the JWT and the request's RFC 9449
DPoP proof.
See [Agent identity architecture](agent-identity.md) for the authority and
resource-server model.

## Workload Token Exchange

Workload exchange accepts RS256 or ES256 assertions only when issuer, subject
pattern, audience, verification key, and calling client match a registered
federated credential.

Realmroot controls issuer, audience, client, scope, tenant, token type,
and lifetime. Private assertion claims are not copied into the issued token.
New exchanged access tokens are signed `at+jwt` tokens whose `sub` is the
trusted external workload and whose `client_id` identifies the authenticated
Application. Since this profile accepts no `actor_token`, it emits no `act`. They may
be introspected only by their owning confidential client. Previously issued
`fatx_` opaque access tokens remain introspectable until expiry or revocation.

Token-exchange refresh credentials are hashed and rotate on every use. Reuse
revokes the token family, and every refresh rechecks client authentication,
allowed scope, and federated-credential status.

## Secret And Schema Ownership

- `BETTER_AUTH_SECRET` is unique to a deployment.
- OAuth client secrets are stored hashed and shown only when created or
  rotated.
- Provider access and refresh credentials are stored hashed where persisted.
- Better Auth owns its OAuth client, access-token, refresh-token, consent, and
  signing-key tables.
- Realmroot owns resource authorization, roles, Agent identities, grants,
  federated credentials, and encrypted external-resource credentials.

The [tenancy model](tenancy.md) explains why this entire protocol and storage
boundary belongs to one deployment.
