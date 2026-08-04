import { badRequest, forbidden } from '@server/domain/errors'
import { getAssetObject, updateUserAvatar, uploadAsset } from '@server/usecases/assets'
import { defaultAccountCenterSettings, getConfig } from '@server/usecases/configz'
import type { ConfigzAccountCenter } from '@server/usecases/ports'
import type { SecurityPolicy } from '@shared/api/security'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { configzOptions } from '../app-config'
import { getPrincipal } from '../middleware/authn'
import { authenticatedUser } from '../middleware/authz'
import { getDeps } from '../middleware/deps'

export function createAssetRoutes() {
  const app = new Hono()

  app.get('/:assetId', async (c) => {
    const { asset, object } = await getAssetObject(getDeps(c), c.req.param('assetId'))
    return new Response(object.body, {
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
        'content-length': String(asset.byteSize),
        'content-type': asset.contentType,
        etag: asset.checksumSha256,
        'x-content-type-options': 'nosniff',
      },
    })
  })

  return app
}

export function createAccountAssetRoutes(securityPolicy?: SecurityPolicy) {
  const app = new Hono()

  app.use('*', authenticatedUser())

  app.post('/avatar', async (c) => {
    const accountCenter = await accountCenterSettings(c, securityPolicy)
    if (!accountCenter.profileEditingEnabled || !accountCenter.avatarEditable) {
      throw forbidden('Avatar editing is disabled for this account center.')
    }
    const deps = getDeps(c)
    const asset = await uploadAsset(deps, {
      purpose: 'avatar',
      file: await readUploadFile(await c.req.raw.formData()),
      actorUserId: getPrincipal(c).user!.id,
    })
    await updateUserAvatar(deps, getPrincipal(c).user!.id, asset.asset)
    return c.json(asset, 201)
  })

  return app
}

async function accountCenterSettings(c: Context, securityPolicy?: SecurityPolicy): Promise<ConfigzAccountCenter> {
  const deps = getDeps(c)
  if (!deps) return defaultAccountCenterSettings
  return (await getConfig(deps, configzOptions(c, securityPolicy))).accountCenter
}

export function createProtectedResourceAssetRoutes() {
  const app = new Hono()

  app.post('/assets', async (c) => {
    const deps = getDeps(c)
    const form = await c.req.raw.formData()
    const purpose = form.get('purpose')
    if (
      purpose !== 'avatar' &&
      purpose !== 'application_logo' &&
      purpose !== 'organization_logo' &&
      purpose !== 'branding_logo' &&
      purpose !== 'favicon'
    ) {
      throw badRequest('Asset purpose is required.')
    }
    const asset = await uploadAsset(deps, {
      purpose,
      file: await readUploadFile(form),
      actorUserId: getPrincipal(c).user?.id ?? null,
    })
    c.header('Location', `/api/assets/${encodeURIComponent(asset.asset.id)}`)
    return c.json(asset, 201)
  })

  return app
}

async function readUploadFile(form: FormData) {
  const file = form.get('file')

  if (!isUploadFile(file)) {
    throw badRequest('Upload file is required.')
  }

  return file
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function' &&
    'type' in value &&
    typeof value.type === 'string'
  )
}
