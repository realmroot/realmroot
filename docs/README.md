# Realmroot Technical Documentation

This directory explains Realmroot's stable technical model and operational
boundaries. It is written for engineers and Agents that need to understand the
system, not as a second copy of executable contracts or product behaviour.

## Product

- [Value proposition](product/value-proposition.md): the Agent tool plane,
  identity and trust infrastructure, product thesis, and responsibility
  boundaries, in English and Chinese.

## Architecture

- [Architecture decision records](adr/README.md): accepted decisions,
  alternatives, consequences, and supersession history.

- [Clean architecture](architecture/clean-architecture.md): source layout,
  dependency direction, runtime composition, and persistence boundaries.
- [Auth provider](architecture/auth-provider.md): issuer model, OAuth/OIDC
  protocol surface, token shapes, and client model.
- [Agent identity](architecture/agent-identity.md): durable Agent identities,
  controller authority, and delegated API access.
- [Provider Adapter runtime](architecture/provider-adapter-reference.md):
  published-operation, credential, and failure boundaries.
- [Resource lifecycle](architecture/resource-lifecycle-reference.md): current
  delete, revoke, and business-key behavior by resource.
- [Security controls](architecture/security-controls.md): deployment security
  policy and WebAuthn configuration.

## API

- [Resource API](api/resource-api.md): the unified API boundary,
  authentication model, errors, pagination, and contract discovery.

The runtime OpenAPI document at `/api/openapi.json` is authoritative for paths,
operations, schemas, and required capabilities. Do not copy its endpoint
inventory into prose documentation.

## Guides

- [Agent access](guides/agent-access.md): stable enrollment, management
  authority, native and external API grants, direct DPoP access, and lifecycle
  controls.

## Integration

- [Resource server integration](integrations/resource-servers.md): connect
  Realmroot-native or external protected APIs, publish discovery metadata, and
  validate access tokens and DPoP proofs.
- [Agent-native Resource Server Profile](integrations/agent-native-resource-server-profile.md):
  the versioned RFC, open-specification, draft, and Realmroot-extension
  capability inventory for direct Agent integration.

## Deployment

- [Cloudflare deployment](deploy/cloudflare.md)
- [Fresh deployment onboarding](deploy/setup.md)
- [Deployment upgrades](deploy/upgrades.md)

## Integration Examples

- [Native resource server](../examples/native-resource-server/README.md):
  standalone API that validates Realmroot-issued tokens.
- [External resource server](../examples/external-resource-server/README.md):
  standalone target platform with its own OAuth authorization server.

## Sources Of Truth

- [`specs/*.feature`](../specs/README.md) owns user-visible behaviour, journeys,
  and their canonical executable proof layer.
- `skills/realmroot/` owns Agent operating procedures and generated Restish
  command workflows.
- `skills/integrate-realmroot-application/` owns product OAuth and OIDC
  integration workflows.
- `skills/integrate-realmroot-resource-server/` owns protected API discovery,
  authorization enforcement, registration, and Agent acceptance requirements;
  it does not own general business API design guidance.
- `/api/openapi.json` owns the live Resource API contract.
- `docs/architecture/` owns mutable implementation maps and protocol reference;
  `docs/adr/` is the only home for consequential decisions and their rationale.

Historical acceptance evidence, progress logs, command transcripts, and copied
endpoint catalogs do not belong in this directory.
