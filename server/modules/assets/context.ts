import type { Context } from 'hono'
import { createDb } from '../../db/client'
import { createDrizzleAssetRepository } from './drizzle-repository'
import { AssetService } from './service'

export interface AssetBindings {
  ASSET_BUCKET: R2Bucket
  DB: D1Database
}

export function createAssetService(c: Context<{ Bindings: AssetBindings }>) {
  const url = new URL(c.req.url)
  return new AssetService(createDrizzleAssetRepository(createDb(c.env.DB)), c.env.ASSET_BUCKET, url.origin)
}
