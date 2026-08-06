import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openApiSemanticSnapshot } from '../../../scripts/openapi-semantic-snapshot'
import { unifiedOpenApi } from './management'

describe('OpenAPI semantic contract gate', () => {
  it('matches the complete origin/main contract with zero allowlist', () => {
    const unchanged = JSON.parse(
      readFileSync(new URL('./origin-main-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as { method: string; path: string; operationId: string; semanticHash: string }[]
    const authorizationContract = JSON.parse(
      readFileSync(new URL('./approved-authorization-semantic-baseline.json', import.meta.url), 'utf8'),
    ) as typeof unchanged
    const baseline = [...unchanged, ...authorizationContract].sort((left, right) =>
      `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`),
    )

    expect(openApiSemanticSnapshot(unifiedOpenApi as unknown as Record<string, unknown>, () => true)).toEqual(baseline)
  })
})
