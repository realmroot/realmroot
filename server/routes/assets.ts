import type { Context } from 'hono'
import { Hono } from 'hono'
import { badRequest, forbidden } from '../lib/errors'
import { requireAdmin, requireAuth } from '../middleware/admin'
import { getAuthContext } from '../middleware/auth-context'
import { type AssetBindings, createAssetService } from '../modules/assets/context'
import type { AssetService } from '../modules/assets/service'
import { type ConfigzBindings, createConfigzService } from '../modules/configz/context'
import { type ConfigzAccountCenter, defaultAccountCenterSettings } from '../modules/configz/service'

export type AssetServiceFactory = (c: Parameters<typeof createAssetService>[0]) => AssetService
export type AccountCenterConfigFactory = (
  c: Context<{ Bindings: AssetBindings & ConfigzBindings }>,
) => Promise<ConfigzAccountCenter>

export function createAssetRoutes(assetServiceFactory: AssetServiceFactory = createAssetService) {
  const app = new Hono<{ Bindings: AssetBindings }>()

  app.get('/:assetId', async (c) => {
    const { asset, object } = await assetServiceFactory(c).getObject(c.req.param('assetId'))
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

export function createAccountAssetRoutes(
  assetServiceFactory: AssetServiceFactory = createAssetService,
  accountCenterConfigFactory?: AccountCenterConfigFactory,
) {
  const app = new Hono<{ Bindings: AssetBindings & ConfigzBindings }>()

  app.use('*', requireAuth())

  app.post('/avatar', async (c) => {
    const accountCenter = c.env?.DB
      ? await (accountCenterConfigFactory ?? defaultAccountCenterConfig)(c)
      : accountCenterConfigFactory
        ? await accountCenterConfigFactory(c)
        : defaultAccountCenterSettings
    if (!accountCenter.profileEditingEnabled || !accountCenter.avatarEditable) {
      throw forbidden('Avatar editing is disabled for this account center.')
    }
    const service = assetServiceFactory(c)
    const asset = await service.upload({
      purpose: 'avatar',
      file: await readUploadFile(c.req.raw),
      actorUserId: getAuthContext(c).user!.id,
    })
    await service.updateUserAvatar(getAuthContext(c).user!.id, asset.asset)
    return c.json(asset, 201)
  })

  return app
}

async function defaultAccountCenterConfig(c: Context<{ Bindings: AssetBindings & ConfigzBindings }>) {
  return (await createConfigzService(c as unknown as Context<{ Bindings: ConfigzBindings }>).getConfig()).accountCenter
}

export function createManagementAssetRoutes(assetServiceFactory: AssetServiceFactory = createAssetService) {
  const app = new Hono<{ Bindings: AssetBindings }>()

  app.use('*', requireAdmin())

  app.post('/applications/:applicationId/logo', async (c) => {
    const service = assetServiceFactory(c)
    const asset = await service.upload({
      purpose: 'application_logo',
      file: await readUploadFile(c.req.raw),
      actorUserId: getAuthContext(c).user?.id ?? null,
    })
    await service.updateApplicationLogo(c.req.param('applicationId'), asset.asset)
    return c.json(asset, 201)
  })

  app.post('/organizations/:organizationId/logo', async (c) => {
    const service = assetServiceFactory(c)
    const asset = await service.upload({
      purpose: 'organization_logo',
      file: await readUploadFile(c.req.raw),
      actorUserId: getAuthContext(c).user?.id ?? null,
    })
    await service.updateOrganizationLogo(c.req.param('organizationId'), asset.asset)
    return c.json(asset, 201)
  })

  app.post('/branding/logo', async (c) => {
    const service = assetServiceFactory(c)
    const asset = await service.upload({
      purpose: 'branding_logo',
      file: await readUploadFile(c.req.raw),
      actorUserId: getAuthContext(c).user?.id ?? null,
    })
    await service.updateBrandingAsset('logo', asset.asset)
    return c.json(asset, 201)
  })

  app.post('/branding/favicon', async (c) => {
    const service = assetServiceFactory(c)
    const asset = await service.upload({
      purpose: 'favicon',
      file: await readUploadFile(c.req.raw),
      actorUserId: getAuthContext(c).user?.id ?? null,
    })
    await service.updateBrandingAsset('favicon', asset.asset)
    return c.json(asset, 201)
  })

  return app
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
