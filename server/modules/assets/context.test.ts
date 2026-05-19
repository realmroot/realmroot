import { describe, expect, it } from 'vitest'
import { createAssetService } from './context'

describe('createAssetService', () => {
  it('creates an asset service from Cloudflare bindings and request origin', () => {
    const db = {} as D1Database
    const bucket = {} as R2Bucket
    const service = createAssetService({
      env: { DB: db, ASSET_BUCKET: bucket },
      req: { url: 'https://auth.example.com/api/account/avatar' },
    } as Parameters<typeof createAssetService>[0])

    expect(service).toHaveProperty('upload')
    expect(service).toHaveProperty('getObject')
  })
})
