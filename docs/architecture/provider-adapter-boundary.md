# Provider Adapter Boundary

Status: **normative architecture constraint**

Realmroot integrates protected APIs through exactly two authorization models:

- `native`: Realmroot is the final access-token issuer and the Resource Server
  validates Realmroot tokens directly.
- `external`: the authorization server advertised by the protected Resource
  issues the final access token and the Resource Server validates that token.

An Adapter for a platform that cannot yet implement the Agent-native profile is
an `external` authorization server and Resource Server. It is not a third
Realmroot authorization model and must not require provider-specific branches
inside Realmroot.

## Non-negotiable boundary

```text
Authentication
Controller -> Realmroot Connector authentication facet -> Better Auth provider

Resource authorization
Controller -> Realmroot Connector resource-authorization facet
           -> Adapter OAuth authorization server -> Provider authorization

Agent operation
Agent -> Realmroot approval and grant
      -> Adapter token exchange
      -> Adapter-issued DPoP token
      -> Adapter Resource Server
      -> Provider API
```

One logical Connector represents one provider in Realmroot. A Connector may
enable authentication, resource authorization, or both. The two facets may use
the same provider application credentials, but their callbacks, state, tokens,
storage, and business meaning remain separate. Account Center presents one
Provider Connection for the provider rather than exposing transport-specific
connections.

Realmroot MUST NOT:

- add another authorization model for an Adapter or provider;
- store provider access tokens, refresh tokens, installation credentials, App
  private keys, webhook cursors, or provider lifecycle state;
- implement provider-specific OAuth stages, scope translation, API routing,
  credential refresh, revocation, or webhook semantics;
- interpret provider-private authorization-detail fields beyond generic RFC
  9396 structure and configured type support;
- proxy provider business API traffic;
- introduce a private Realmroot-to-Adapter account-connection protocol.

An Adapter MUST:

- expose a standard OAuth/OIDC authorization server usable by Realmroot's
  external Resource flow;
- publish RFC 9728 protected-resource metadata and an OpenAPI service
  description for the API it exposes;
- own provider authorization, credential encryption, refresh, revocation,
  lifecycle signals, scope mapping, operation publication, and provider audit
  correlation;
- issue the final short-lived DPoP-bound Agent token and validate it at the
  Adapter Resource boundary;
- keep provider credentials outside Realmroot, Agent, CLI, and API responses;
- preserve the provider API's method, path, query, body, response, error,
  retry, and idempotency semantics wherever the published operation permits;
- expose only explicitly published operations with an exact provider-permission
  to Agent-scope mapping;
- isolate compatibility transformations to the provider module and document
  every transformation;
- fail closed when provider authority is revoked, reduced, expired, ambiguous,
  or cannot be refreshed safely.

The provider remains the owner of its business API and permission vocabulary.
The Adapter may mirror that vocabulary as Agent scopes; it must not invent a
parallel Adapter-owned business model.

## Token and credential ownership

| Artifact | Owner |
| --- | --- |
| Stable Agent identity and controller approval | Realmroot |
| Agent grant and Entitlements | Realmroot |
| Connector product identity and OAuth client configuration | Realmroot |
| Adapter-issued subject and refresh credentials used by Realmroot | Adapter authorization server |
| Provider access and refresh credentials | Adapter provider module |
| Final business API DPoP token | External authorization server implemented by Adapter |
| Provider installation, workspace, account, repository, and webhook state | Adapter provider module |
| Business object authorization and operation result | Provider API, enforced through Adapter boundary |

Realmroot returns an external final token unchanged. It does not wrap or
re-sign that token. The Adapter intersects the connected subject authority,
controller-approved Agent scopes, optional authorization details, provider
grant, and DPoP key before issuance.

## Provider-specific authority

Use RFC 9396 authorization details only when one connected provider identity
contains multiple independently selectable execution authorities. GitHub App
installations and selected repositories require such details. Linear workspace
identity is the Provider Connection subject and Cloudflare account or zone IDs
are ordinary API parameters, so neither creates an extra Realmroot Context.

Realmroot treats authorization details as opaque provider-owned values after
generic structural, type, subset, and replay checks. The Adapter owns their
field semantics and enforces them before both token issuance and operation
execution.

Adapter-defined authorization-detail types use stable HTTPS URIs under the
Adapter's domain. Their catalog keeps human labels separate from the opaque
authorization detail, so clients can display a provider name while grants and
tokens continue to use stable provider identifiers.

When independently selectable authorities can grant different scopes, the
catalog item may publish `grantedScopes` for that exact authorization detail.
Realmroot uses this generic coverage signal only to decide whether the selected
authority requires external reauthorization. The external authorization server
still owns the scope meaning and MUST enforce the same detail-specific coverage
when issuing the final token.

## Transparent proxy constraint

Transparent proxying is allowed and preferred. It means the Adapter preserves
the provider's published API contract; it does not mean arbitrary upstream URL
forwarding. Every reachable operation must be present in the Adapter's OpenAPI
contract and have a deterministic permission mapping. Header sanitization,
credential substitution, scope enforcement, audit correlation, and a small
documented compatibility transformation registry remain mandatory.

## Adding a provider

Adding a provider normally changes only the Adapter project:

1. add the provider authorization driver and encrypted credential store;
2. publish protected-resource metadata, OAuth metadata, and OpenAPI;
3. map provider permissions to scopes and operations;
4. implement transparent forwarding and required compatibility transforms;
5. implement refresh, revocation, lifecycle invalidation, and audit;
6. publish a capability manifest and adapter retirement condition;
7. register the provider module in the Adapter Worker.

Realmroot then creates or updates one Connector, enables the required facets,
and registers the Adapter Resource as `external`. A new provider must not
require a Realmroot core-code change. If it appears to require one, reviewers
must first determine whether the missing behavior is a general OAuth/OIDC,
RFC 9396, discovery, or Resource Server capability. Provider-specific behavior
belongs in the Adapter.

## Change control

This boundary is an architecture invariant. A change that moves a Provider
credential or Provider-specific decision into Realmroot, introduces a third
authorization model, or introduces a private Realmroot-to-Adapter connection
protocol is rejected by default. Any proposed exception requires an explicit
architecture decision, migration and removal plan, security analysis, and
updates to this document before implementation.

The strategic exit remains removal of an Adapter after the provider natively
implements the Agent-facing authorization and Resource boundary.
