import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from '@playwright/test'

export default async function globalTeardown() {
  const storageStatePath = process.env.REALMROOT_PVT_STORAGE_STATE_PATH
  const baseURL = process.env.PVT_BASE_URL
  if (!storageStatePath || !baseURL || !existsSync(storageStatePath)) return

  const resolvedPath = resolve(storageStatePath)
  const temporaryPrefix = join(resolve(tmpdir()), 'realmroot-pvt-')
  if (!resolvedPath.startsWith(temporaryPrefix) || !resolvedPath.endsWith('.json')) {
    throw new Error(`Refusing to remove unexpected PVT storage state: ${resolvedPath}`)
  }

  const context = await request.newContext({ baseURL, storageState: resolvedPath })
  try {
    const response = await context.post('/api/auth/sign-out', {
      data: {},
      headers: { origin: new URL(baseURL).origin },
    })
    if (!response.ok()) throw new Error(`PVT session cleanup failed with HTTP ${response.status()}.`)

    const profileResponse = await context.get('/api/account/profile')
    if (profileResponse.status() !== 401) {
      throw new Error(`PVT session remained usable after sign-out (HTTP ${profileResponse.status()}).`)
    }
  } finally {
    await context.dispose()
    rmSync(resolvedPath, { force: true })
  }
}
