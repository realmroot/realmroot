import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  approvedAuthorizationSemanticSnapshot,
  openApiSemanticSnapshot,
} from '../../../scripts/openapi-semantic-snapshot'
import { unifiedOpenApi } from './management'

describe('OpenAPI semantic contract gate', () => {
  it('changes only the approved Organization Role, Member, and Invitation contracts', () => {
    const baseline = JSON.parse(readFileSync(new URL('./origin-main-semantic-baseline.json', import.meta.url), 'utf8'))
    expect(openApiSemanticSnapshot(unifiedOpenApi as unknown as Record<string, unknown>)).toEqual(baseline)
  })

  it('locks the exact approved Organization Role, Member, and Invitation contract', () => {
    const approved = JSON.parse(
      readFileSync(new URL('./approved-authorization-semantic-baseline.json', import.meta.url), 'utf8'),
    )
    expect(approvedAuthorizationSemanticSnapshot(unifiedOpenApi as unknown as Record<string, unknown>)).toEqual(
      approved,
    )
  })
})
