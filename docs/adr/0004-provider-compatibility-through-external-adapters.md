# 0004 — Keep provider compatibility in external Adapters

- Status: Accepted
- Date: 2026-09-02
- Deciders: Realmroot maintainers

## Context

External providers differ in OAuth details, credential lifecycle, scopes, and
API conventions. Encoding those differences in Realmroot core would create a
new authorization model for every provider and make core storage vendor-aware.

## Decision

Realmroot supports two authorization models: native and external. Provider
compatibility lives in independently deployed Adapters that present standard
OAuth authorization-server and protected-resource contracts. One logical
Connector may expose authentication and resource authorization independently.

Realmroot may store encrypted OAuth client configuration and account credentials
needed to integrate with a standards-compatible external Resource Server. An
Adapter, however, owns all credentials, scope translation, lifecycle state, and
API forwarding that are specific to the non-standard upstream provider behind
that Adapter. Those Adapter-private details never enter Realmroot core storage
or policy.

## Consequences

- Adding a provider changes Adapter code and Realmroot configuration, not core
  authorization policy.
- Provider-specific upstream credentials, scope translation, and API routing
  remain inside the Adapter. Realmroot stores only its generic Connector and
  external-resource OAuth state.
- Adapters must satisfy the same discovery, token, revocation, and audit
  boundaries as any external Resource Server.

## Alternatives considered

- Provider SDKs in Realmroot core: rejected because vendor behavior would leak
  across domain and persistence boundaries.
- A third "adapter" authorization model: rejected because it would duplicate
  the external-resource protocol with provider-specific semantics.

## References

- [Provider Adapter runtime reference](../architecture/provider-adapter-reference.md)
- [Resource Server integration](../integrations/resource-servers.md)
- [Agent-native Resource Server profile](../integrations/agent-native-resource-server-profile.md)
- [Connector use cases](../../server/usecases/connectors.ts)
- [External Resource use cases](../../server/usecases/external-resources.ts)
