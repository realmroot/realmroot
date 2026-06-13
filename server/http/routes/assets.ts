import { badRequest, forbidden } from '@server/domain/errors'
import {
  getAssetObject,
  updateApplicationLogo,
  updateBrandingAsset,
  updateOrganizationLogo,
  updateUserAvatar,
  uploadAsset,
} from '@server/usecases/assets'
import { defaultAccountCenterSettings, getConfig } from '@server/usecases/configz'
import type { ConfigzAccountCenter } from '@server/usecases/ports'
import type { SecurityPolicy } from '@shared/api/security'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { configzOptions } from '../app-config'
import { requireAdmin, requireAuth } from '../middleware/admin'
import { getAuthContext } from '../middleware/auth-context'
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

  app.use('*', requireAuth())

  app.post('/avatar', async (c) => {
    const accountCenter = await accountCenterSettings(c, securityPolicy)
    if (!accountCenter.profileEditingEnabled || !accountCenter.avatarEditable) {
      throw forbidden('Avatar editing is disabled for this account center.')
    }
    const deps = getDeps(c)
    const origin = requestOrigin(c)
    const asset = await uploadAsset(deps, origin, {
      purpose: 'avatar',
      file: await readUploadFile(c.req.raw),
      actorUserId: getAuthContext(c).user!.id,
    })
    await updateUserAvatar(deps, getAuthContext(c).user!.id, asset.asset)
    return c.json(asset, 201)
  })

  return app
}

async function accountCenterSettings(c: Context, securityPolicy?: SecurityPolicy): Promise<ConfigzAccountCenter> {
  const deps = getDeps(c)
  if (!deps) return defaultAccountCenterSettings
  return (await getConfig(deps, configzOptions(c, securityPolicy))).accountCenter
}

export function createManagementAssetRoutes() {
  const app = new Hono()

  app.use('*', requireAdmin())

  app.post('/applications/:applicationId/logo', async (c) => {
    const deps = getDeps(c)
    const asset = await uploadAsset(deps, requestOrigin(c), {
      purpose: 'application_logo',
      file: await readUploadFile(c.req.raw),
      actorUserId: getAuthContext(c).user?.id ?? null,
    })
    await updateApplicationLogo(deps, c.req.param('applicationId'), asset.asset)
    return c.json(asset, 201)
  })

  app.post('/organizations/:organizationId/logo', async (c) => {
    const deps = getDeps(c)
    const asset = await uploadAsset(deps, requestOrigin(c), {
      purpose: 'organization_logo',
      file: await readUploadFile(c.req.raw),
      actorUserId: getAuthContext(c).user?.id ?? null,
    })
    await updateOrganizationLogo(deps, c.req.param('organizationId'), asset.asset)
    return c.json(asset, 201)
  })

  app.post('/branding/logo', async (c) => {
    const deps = getDeps(c)
    const asset = await uploadAsset(deps, requestOrigin(c), {
      purpose: 'branding_logo',
      file: await readUploadFile(c.req.raw),
      actorUserId: getAuthContext(c).user?.id ?? null,
    })
    await updateBrandingAsset(deps, 'logo', asset.asset)
    return c.json(asset, 201)
  })

  app.post('/branding/favicon', async (c) => {
    const deps = getDeps(c)
    const asset = await uploadAsset(deps, requestOrigin(c), {
      purpose: 'favicon',
      file: await readUploadFile(c.req.raw),
      actorUserId: getAuthContext(c).user?.id ?? null,
    })
    await updateBrandingAsset(deps, 'favicon', asset.asset)
    return c.json(asset, 201)
  })

  return app
}

function requestOrigin(c: Context) {
  return new URL(c.req.url).origin
}

async function readUploadFile(request: Request) {
  const form = await request.formData()
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
