# Realmroot Technical Documentation

This directory explains Realmroot's stable technical model and operational
boundaries. It is written for engineers and Agents that need to understand the
system, not as a second copy of executable contracts or product behaviour.

## Product

- [Value proposition](product/value-proposition.md): the Agent tool plane,
  identity and trust infrastructure, product thesis, and responsibility
  boundaries, in English and Chinese.

## Architecture

- [Clean architecture](architecture/clean-architecture.md): source layout,
  dependency direction, runtime composition, and persistence boundaries.
- [Auth provider](architecture/auth-provider.md): issuer model, OAuth/OIDC
  protocol surface, token shapes, and client model.
- [Agent identity](architecture/agent-identity.md): durable Agent identities,
  controller authority, and delegated API access.
- [Authorization boundaries](architecture/authorization-boundaries.md): scope
  ownership, role semantics and assignments, token issuance, and final
  resource-server enforcement.
- [Tenancy](architecture/tenancy.md): the deployment, user-pool, and isolation
  boundary.
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

- `specs/*.feature` owns user-visible behaviour and journeys.
- `skills/realmroot/` owns Agent operating procedures and generated Restish
  command workflows.
- `skills/design-resource-api/` owns the Agent process for designing
  resource-oriented APIs and reviewing exceptional command surfaces.
- `/api/openapi.json` owns the live Resource API contract.
- `docs/` owns durable technical explanation and architectural decisions.

Historical acceptance evidence, progress logs, command transcripts, and copied
endpoint catalogs do not belong in this directory.
