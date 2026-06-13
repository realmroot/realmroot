import { badRequest, notFound } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { UploadedAssetRecord } from '@server/usecases/ports'
import type { AssetPurpose, UploadedAssetResponse } from '@shared/api/assets'

const allowedContentTypes: Record<AssetPurpose, readonly string[]> = {
  avatar: ['image/png', 'image/jpeg', 'image/webp'],
  application_logo: ['image/png', 'image/jpeg', 'image/webp'],
  organization_logo: ['image/png', 'image/jpeg', 'image/webp'],
  branding_logo: ['image/png', 'image/jpeg', 'image/webp'],
  favicon: ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/webp'],
}

const maxByteSizes: Record<AssetPurpose, number> = {
  avatar: 2 * 1024 * 1024,
  application_logo: 2 * 1024 * 1024,
  organization_logo: 2 * 1024 * 1024,
  branding_logo: 2 * 1024 * 1024,
  favicon: 512 * 1024,
}

export async function uploadAsset(
  deps: Deps,
  origin: string,
  input: {
    purpose: AssetPurpose
    file: File
    actorUserId: string | null
  },
): Promise<UploadedAssetResponse> {
  const { bytes, contentType } = await validate(input.purpose, input.file)
  const checksumSha256 = await sha256Hex(bytes)
  const assetId = createId('asset')
  const storageKey = `${input.purpose}/${checksumSha256.slice(0, 2)}/${assetId}-${safeFileName(input.file.name)}`
  const publicUrl = new URL(`/api/assets/${assetId}`, origin).toString()

  await deps.assetStorage.put(storageKey, bytes, { httpMetadata: { contentType } })
  const asset = await deps.assets.createAsset({
    id: assetId,
    purpose: input.purpose,
    storageKey,
    publicUrl,
    contentType,
    byteSize: bytes.byteLength,
    checksumSha256,
    createdByUserId: input.actorUserId,
  })

  return { asset: toResponse(asset) }
}

export async function getAssetObject(deps: Deps, assetId: string) {
  const asset = await deps.assets.findAsset(assetId)
  if (!asset) {
    throw notFound('Asset was not found.')
  }

  const object = await deps.assetStorage.get(asset.storageKey)
  if (!object) {
    throw notFound('Asset object was not found.')
  }

  return { asset, object }
}

export function updateUserAvatar(deps: Deps, userId: string, asset: UploadedAssetResponse['asset']) {
  return deps.assets.updateUserAvatar(userId, asset.id, asset.publicUrl)
}

export function updateApplicationLogo(deps: Deps, applicationId: string, asset: UploadedAssetResponse['asset']) {
  return deps.assets.updateApplicationLogo(applicationId, asset.id, asset.publicUrl)
}

export function updateOrganizationLogo(deps: Deps, organizationId: string, asset: UploadedAssetResponse['asset']) {
  return deps.assets.updateOrganizationLogo(organizationId, asset.id, asset.publicUrl)
}

export function updateBrandingAsset(deps: Deps, kind: 'logo' | 'favicon', asset: UploadedAssetResponse['asset']) {
  return deps.assets.updateBrandingAsset(kind, asset.id)
}

async function validate(purpose: AssetPurpose, file: File) {
  if (file.size === 0) {
    throw badRequest('Upload file is required.')
  }

  if (file.size > maxByteSizes[purpose]) {
    throw badRequest(`File exceeds the ${maxByteSizes[purpose]} byte limit.`)
  }

  const declaredContentType = normalizeContentType(file.type)
  if (!allowedContentTypes[purpose].includes(file.type) || !declaredContentType) {
    throw badRequest(`Unsupported file type for ${purpose}.`)
  }

  const bytes = await file.arrayBuffer()
  const contentType = sniffContentType(bytes)
  if (!contentType || contentType !== declaredContentType) {
    throw badRequest(`Unsupported file type for ${purpose}.`)
  }

  return { bytes, contentType }
}

function toResponse(asset: UploadedAssetRecord): UploadedAssetResponse['asset'] {
  return {
    id: asset.id,
    purpose: asset.purpose,
    publicUrl: asset.publicUrl,
    contentType: asset.contentType,
    byteSize: asset.byteSize,
    checksumSha256: asset.checksumSha256,
    createdAt: asset.createdAt.toISOString(),
  }
}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function safeFileName(name: string) {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'upload'
}

function normalizeContentType(contentType: string) {
  if (contentType === 'image/vnd.microsoft.icon') return 'image/x-icon'
  return contentType
}

function sniffContentType(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes)
  if (startsWith(view, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(view, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (
    view.length >= 12 &&
    startsWith(view, [0x52, 0x49, 0x46, 0x46]) &&
    view[8] === 0x57 &&
    view[9] === 0x45 &&
    view[10] === 0x42 &&
    view[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (startsWith(view, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon'
  return null
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[index] === byte)
}
