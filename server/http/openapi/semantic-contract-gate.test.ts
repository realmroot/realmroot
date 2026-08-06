import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openApiSemanticSnapshot } from '../../../scripts/openapi-semantic-snapshot'
import { unifiedOpenApi } from './management'

describe('OpenAPI semantic contract gate', () => {
  it('matches origin/main except for approved explicit owner selectors', () => {
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
    const approvedChanges = new Set(
      [...ownerSelectorContract, ...documentationContract].map(({ method, path }) => `${method}:${path}`),
    )
    const baseline = [
      ...unchanged.filter(({ method, path }) => !approvedChanges.has(`${method}:${path}`)),
      ...authorizationContract,
      ...ownerSelectorContract,
      ...documentationContract,
    ].sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))

    expect(openApiSemanticSnapshot(unifiedOpenApi as unknown as Record<string, unknown>, () => true)).toEqual(baseline)
  })
})
