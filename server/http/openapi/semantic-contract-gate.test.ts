import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openApiSemanticSnapshot } from '../../../scripts/openapi-semantic-snapshot'
import { unifiedOpenApi } from './management'

describe('OpenAPI semantic contract gate', () => {
  it('matches origin/main except for approved contract changes', () => {
    const unchanged = JSON.parse(
      readFileSync(new URL('./origin-main-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as { method: string; path: string; operationId: string; semanticHash: string }[]
    const authorizationContract = JSON.parse(
      readFileSync(new URL('./approved-authorization-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const ownerSelectorContract = JSON.parse(
      readFileSync(new URL('./approved-owner-selector-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const documentationContract = JSON.parse(
      readFileSync(new URL('./approved-documentation-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const resourceDiscoveryContract = JSON.parse(
      readFileSync(new URL('./approved-resource-discovery-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const publicProfilesContract = JSON.parse(
      readFileSync(new URL('./approved-public-profiles-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const brokeredNativeContract = JSON.parse(
      readFileSync(new URL('./approved-brokered-native-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const authenticationContract = JSON.parse(
      readFileSync(new URL('./approved-authentication-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const permissionContract = JSON.parse(
      readFileSync(new URL('./approved-permission-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const runtimeApiContract = JSON.parse(
      readFileSync(new URL('./approved-runtime-api-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const m2mApplicationContract = JSON.parse(
      readFileSync(new URL('./approved-m2m-application-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const brokeredContextCatalogContract = JSON.parse(
      readFileSync(new URL('./approved-brokered-context-catalog-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const agentUsernameContract = JSON.parse(
      readFileSync(new URL('./approved-agent-username-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const collectionEnvelopeContract = JSON.parse(
      readFileSync(new URL('./approved-collection-envelope-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const applicationConsentContract = JSON.parse(
      readFileSync(new URL('./approved-application-consent-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const resourceAuthorizationModelContract = JSON.parse(
      readFileSync(new URL('./approved-resource-authorization-model-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const tokenProfileContract = JSON.parse(
      readFileSync(new URL('./approved-token-profile-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const applicationOwnerImmutabilityContract = JSON.parse(
      readFileSync(
        new URL('./approved-application-owner-immutability-semantic-baseline.json', import.meta.url),
        'utf8',
      ),
    ) as typeof unchanged
    const applicationAgentCreationContract = JSON.parse(
      readFileSync(new URL('./approved-application-agent-creation-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const brokeredNativeChanges = new Set(brokeredNativeContract.map(({ method, path }) => `${method}:${path}`))
    const resourceDiscoveryChanges = new Set(resourceDiscoveryContract.map(({ method, path }) => `${method}:${path}`))
    const approvedChanges = new Set(
      [
        ...ownerSelectorContract,
        ...documentationContract,
        ...resourceDiscoveryContract,
        ...brokeredNativeContract,
        ...publicProfilesContract,
        ...brokeredContextCatalogContract,
      ].map(({ method, path }) => `${method}:${path}`),
    )
    const approvedRemovals = new Set([
      ...['DELETE', 'GET', 'PUT'].flatMap((method) => [
        `${method}:/agents/{agentId}/retirement`,
        `${method}:/resource-servers/{resourceServerId}/archival`,
      ]),
      'GET:/access/consents',
      'GET:/access/consents/{consentId}',
      'GET:/access/consents/{consentId}/revocation',
      'PUT:/access/consents/{consentId}/revocation',
      'GET:/access/requests',
      'POST:/access/requests',
      'GET:/access/requests/{requestId}',
      'POST:/access/requests/{requestId}/credentials',
      'GET:/access/requests/{requestId}/decision',
      'PUT:/access/requests/{requestId}/decision',
      'GET:/agent/status',
      'POST:/resource-servers/{resourceServerId}/connection-requests',
      'GET:/resource-servers/{resourceServerId}/connection-requests/{requestId}',
      'POST:/agents/{agentId}/scope-entitlements/{grantId}/credentials',
      'GET:/resource-servers/{resourceServerId}/resources',
      'GET:/resource-servers/{resourceServerId}/resources/{resourceId}',
      'PUT:/resource-servers/{resourceServerId}/connection-events/{eventId}',
    ])
    const priorBaseline = [
      ...unchanged.filter(
        ({ method, path }) => !approvedChanges.has(`${method}:${path}`) && !approvedRemovals.has(`${method}:${path}`),
      ),
      ...authorizationContract,
      ...ownerSelectorContract.filter(
        ({ method, path }) =>
          !resourceDiscoveryChanges.has(`${method}:${path}`) &&
          !brokeredNativeChanges.has(`${method}:${path}`) &&
          !approvedRemovals.has(`${method}:${path}`),
      ),
      ...documentationContract,
      ...resourceDiscoveryContract.filter(({ method, path }) => !brokeredNativeChanges.has(`${method}:${path}`)),
      ...brokeredNativeContract,
      ...publicProfilesContract,
      ...brokeredContextCatalogContract,
    ].sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))
    const authenticationChanges = new Set(authenticationContract.map(({ method, path }) => `${method}:${path}`))
    const authenticationBaseline = [
      ...priorBaseline.filter(({ method, path }) => !authenticationChanges.has(`${method}:${path}`)),
      ...authenticationContract,
    ].sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))
    const permissionSurface = ({ method, path }: { method: string; path: string }) =>
      path.includes('/permissions') ||
      path.includes('/authorized-resource-servers') ||
      path.includes('/scope-entitlements') ||
      path.includes('/scope-grants') ||
      path.includes('/access-grants') ||
      (method === 'GET' && (path === '/agents' || path === '/agents/{agentId}' || path === '/realm/audit-events'))
    const m2mApplicationChanges = new Set(m2mApplicationContract.map(({ method, path }) => `${method}:${path}`))
    const brokeredContextCatalogChanges = new Set(
      brokeredContextCatalogContract.map(({ method, path }) => `${method}:${path}`),
    )
    const preAgentUsernameBaseline = [
      ...authenticationBaseline.filter(
        (operation) =>
          !permissionSurface(operation) &&
          !m2mApplicationChanges.has(`${operation.method}:${operation.path}`) &&
          !brokeredContextCatalogChanges.has(`${operation.method}:${operation.path}`),
      ),
      ...permissionContract.filter(({ method, path }) => !brokeredContextCatalogChanges.has(`${method}:${path}`)),
      ...runtimeApiContract.filter(({ method, path }) => !brokeredContextCatalogChanges.has(`${method}:${path}`)),
      ...m2mApplicationContract.filter(({ method, path }) => !brokeredContextCatalogChanges.has(`${method}:${path}`)),
      ...brokeredContextCatalogContract,
    ].sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))
    const agentUsernameChanges = new Set(agentUsernameContract.map(({ method, path }) => `${method}:${path}`))
    const preCollectionEnvelopeBaseline = [
      ...preAgentUsernameBaseline.filter(({ method, path }) => !agentUsernameChanges.has(`${method}:${path}`)),
      ...agentUsernameContract,
    ].sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))
    const collectionEnvelopeChanges = new Set(collectionEnvelopeContract.map(({ method, path }) => `${method}:${path}`))
    const preApplicationConsentBaseline = [
      ...preCollectionEnvelopeBaseline.filter(
        ({ method, path }) => !collectionEnvelopeChanges.has(`${method}:${path}`),
      ),
      ...collectionEnvelopeContract,
    ].sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))
    const applicationConsentChanges = new Set(applicationConsentContract.map(({ method, path }) => `${method}:${path}`))
    const preResourceAuthorizationModelBaseline = [
      ...preApplicationConsentBaseline.filter(
        ({ method, path }) => !applicationConsentChanges.has(`${method}:${path}`),
      ),
      ...applicationConsentContract,
    ].sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))
    const resourceAuthorizationModelChanges = new Set(
      resourceAuthorizationModelContract.map(({ method, path }) => `${method}:${path}`),
    )
    const tokenProfileChanges = new Set(tokenProfileContract.map(({ method, path }) => `${method}:${path}`))
    const preApplicationOwnerImmutabilityBaseline = [
      ...preResourceAuthorizationModelBaseline.filter(
        ({ method, path }) =>
          !resourceAuthorizationModelChanges.has(`${method}:${path}`) &&
          !tokenProfileChanges.has(`${method}:${path}`) &&
          !approvedRemovals.has(`${method}:${path}`),
      ),
      ...resourceAuthorizationModelContract.filter(({ method, path }) => !tokenProfileChanges.has(`${method}:${path}`)),
      ...tokenProfileContract,
    ].sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))
    const applicationOwnerImmutabilityChanges = new Set(
      applicationOwnerImmutabilityContract.map(({ method, path }) => `${method}:${path}`),
    )
    const baseline = [
      ...preApplicationOwnerImmutabilityBaseline.filter(
        ({ method, path }) => !applicationOwnerImmutabilityChanges.has(`${method}:${path}`),
      ),
      ...applicationOwnerImmutabilityContract,
      ...applicationAgentCreationContract,
    ].sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))

    expect(openApiSemanticSnapshot(unifiedOpenApi as unknown as Record<string, unknown>, () => true)).toEqual(baseline)
  })
})
