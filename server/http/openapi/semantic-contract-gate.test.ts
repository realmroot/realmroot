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
    const providerConnectionEventsContract = JSON.parse(
      readFileSync(new URL('./approved-provider-connection-events-semantic-baseline.json', import.meta.url), 'utf8'),
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
        ...providerConnectionEventsContract,
      ].map(({ method, path }) => `${method}:${path}`),
    )
    const approvedRemovals = new Set([
      ...['DELETE', 'GET', 'PUT'].flatMap((method) => [
        `${method}:/agents/{agentId}/retirement`,
        `${method}:/resource-servers/{resourceServerId}/archival`,
      ]),
      'POST:/agents/{agentId}/access-grants/{grantId}/credentials',
    ])
    const baseline = [
      ...unchanged.filter(
        ({ method, path }) => !approvedChanges.has(`${method}:${path}`) && !approvedRemovals.has(`${method}:${path}`),
      ),
      ...authorizationContract,
      ...ownerSelectorContract.filter(
        ({ method, path }) =>
          !resourceDiscoveryChanges.has(`${method}:${path}`) && !brokeredNativeChanges.has(`${method}:${path}`),
      ),
      ...documentationContract,
      ...resourceDiscoveryContract.filter(({ method, path }) => !brokeredNativeChanges.has(`${method}:${path}`)),
      ...brokeredNativeContract,
      ...publicProfilesContract,
      ...providerConnectionEventsContract,
    ].sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))

    expect(openApiSemanticSnapshot(unifiedOpenApi as unknown as Record<string, unknown>, () => true)).toEqual(baseline)
  })
})
