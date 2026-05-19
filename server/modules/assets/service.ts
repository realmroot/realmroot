import type { AssetPurpose, UploadedAssetResponse } from '../../../shared/api/assets'
import { badRequest, notFound } from '../../lib/errors'

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

export interface UploadedAssetRecord {
  id: string
  purpose: AssetPurpose
  storageKey: string
  publicUrl: string
  contentType: string
  byteSize: number
  checksumSha256: string
  createdByUserId: string | null
  createdAt: Date
}

export interface AssetRepository {
  createAsset(input: Omit<UploadedAssetRecord, 'createdAt'>): Promise<UploadedAssetRecord>
  findAsset(id: string): Promise<UploadedAssetRecord | null>
  updateUserAvatar(userId: string, assetId: string, publicUrl: string): Promise<void>
  updateApplicationLogo(applicationId: string, assetId: string, publicUrl: string): Promise<void>
  updateOrganizationLogo(organizationId: string, assetId: string, publicUrl: string): Promise<void>
  updateBrandingAsset(kind: 'logo' | 'favicon', assetId: string): Promise<void>
}

export interface AssetStorage {
  put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>
  get(key: string): Promise<R2ObjectBody | null>
}

export class AssetService {
  constructor(
    private readonly repository: AssetRepository,
    private readonly storage: AssetStorage,
    private readonly publicOrigin: string,
  ) {}

  async upload(input: {
    purpose: AssetPurpose
    file: File
    actorUserId: string | null
  }): Promise<UploadedAssetResponse> {
    const { bytes, contentType } = await this.validate(input.purpose, input.file)
    const checksumSha256 = await sha256Hex(bytes)
    const assetId = createId('asset')
    const storageKey = `${input.purpose}/${checksumSha256.slice(0, 2)}/${assetId}-${safeFileName(input.file.name)}`
    const publicUrl = new URL(`/api/assets/${assetId}`, this.publicOrigin).toString()

    await this.storage.put(storageKey, bytes, { httpMetadata: { contentType } })
    const asset = await this.repository.createAsset({
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

  async getObject(assetId: string) {
    const asset = await this.repository.findAsset(assetId)
    if (!asset) {
      throw notFound('Asset was not found.')
    }

    const object = await this.storage.get(asset.storageKey)
    if (!object) {
      throw notFound('Asset object was not found.')
    }

    return { asset, object }
  }

  updateUserAvatar(userId: string, asset: UploadedAssetResponse['asset']) {
    return this.repository.updateUserAvatar(userId, asset.id, asset.publicUrl)
  }

  updateApplicationLogo(applicationId: string, asset: UploadedAssetResponse['asset']) {
    return this.repository.updateApplicationLogo(applicationId, asset.id, asset.publicUrl)
  }

  updateOrganizationLogo(organizationId: string, asset: UploadedAssetResponse['asset']) {
    return this.repository.updateOrganizationLogo(organizationId, asset.id, asset.publicUrl)
  }

  updateBrandingAsset(kind: 'logo' | 'favicon', asset: UploadedAssetResponse['asset']) {
    return this.repository.updateBrandingAsset(kind, asset.id)
  }

  private async validate(purpose: AssetPurpose, file: File) {
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
