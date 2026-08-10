import { createUuidV7IdentifierGenerator } from '@server/adapters/identifiers/uuid-v7'
import { describe, expect, it } from 'vitest'

describe('UUIDv7 identifier generator', () => {
  it('creates standard unprefixed UUIDv7 identifiers [spec: management-api/management-resource-identifiers]', () => {
    const id = createUuidV7IdentifierGenerator().generate()

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(id).not.toContain('_')
  })
})
