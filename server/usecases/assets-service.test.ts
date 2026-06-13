import {
  getAssetObject,
  updateApplicationLogo,
  updateBrandingAsset,
  updateOrganizationLogo,
  updateUserAvatar,
  uploadAsset,
} from '@server/usecases/assets'
import type { Deps } from '@server/usecases/deps'
import type { AssetRepository, AssetStorage } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

const origin = 'https://auth.example.com'

function depsWith(assets: AssetRepository, assetStorage: AssetStorage): Deps {
  return { assets, assetStorage } as unknown as Deps
}

describe('AssetService', () => {
  it('validates uploads, writes R2 objects, and stores D1 metadata [spec: account-center/profile-avatar-upload]', async () => {
    const repository = createRepository()
    const storage = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn() }
    const deps = depsWith(repository, storage)

    const response = await uploadAsset(deps, origin, {
      purpose: 'avatar',
      file: new File([pngBytes()], 'Ada Lovelace.png', { type: 'image/png' }),
      actorUserId: 'user-1',
    })

    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^avatar\/[a-f0-9]{2}\/asset_[a-f0-9]+-ada-lovelace\.png$/),
      expect.any(ArrayBuffer),
      { httpMetadata: { contentType: 'image/png' } },
    )
    expect(repository.createAsset).toHaveBeenCalledWith({
      id: response.asset.id,
      purpose: 'avatar',
      storageKey: expect.stringContaining(response.asset.id),
      publicUrl: `https://auth.example.com/api/assets/${response.asset.id}`,
      contentType: 'image/png',
      byteSize: 8,
      checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      createdByUserId: 'user-1',
    })
    expect(response.asset).toMatchObject({
      purpose: 'avatar',
      publicUrl: `https://auth.example.com/api/assets/${response.asset.id}`,
      contentType: 'image/png',
      byteSize: 8,
    })
  })

  it('fails fast for unsupported content types, mismatched bytes, and oversized favicons', async () => {
    const deps = depsWith(createRepository(), { put: vi.fn(), get: vi.fn() })

    await expect(
      uploadAsset(deps, origin, {
        purpose: 'application_logo',
        file: new File(['<svg />'], 'logo.svg', { type: 'image/svg+xml' }),
        actorUserId: 'admin-1',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Unsupported file type for application_logo.' })

    await expect(
      uploadAsset(deps, origin, {
        purpose: 'application_logo',
        file: new File(['<svg />'], 'logo.png', { type: 'image/png' }),
        actorUserId: 'admin-1',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Unsupported file type for application_logo.' })

    await expect(
      uploadAsset(deps, origin, {
        purpose: 'favicon',
        file: new File([new Uint8Array(512 * 1024 + 1)], 'favicon.png', { type: 'image/png' }),
        actorUserId: 'admin-1',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'File exceeds the 524288 byte limit.' })
  })

  it('canonicalizes Microsoft icon uploads to the stored content type', async () => {
    const repository = createRepository()
    const storage = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn() }
    const deps = depsWith(repository, storage)

    const response = await uploadAsset(deps, origin, {
      purpose: 'favicon',
      file: new File([icoBytes()], 'favicon.ico', { type: 'image/vnd.microsoft.icon' }),
      actorUserId: 'admin-1',
    })

    expect(storage.put).toHaveBeenCalledWith(expect.any(String), expect.any(ArrayBuffer), {
      httpMetadata: { contentType: 'image/x-icon' },
    })
    expect(response.asset.contentType).toBe('image/x-icon')
    expect(repository.createAsset).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/x-icon' }))
  })

  it('accepts JPEG and WebP uploads when signatures match their declared types', async () => {
    const storage = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn() }
    const deps = depsWith(createRepository(), storage)

    await uploadAsset(deps, origin, {
      purpose: 'avatar',
      file: new File([jpegBytes()], 'avatar.jpg', { type: 'image/jpeg' }),
      actorUserId: 'user-1',
    })
    await uploadAsset(deps, origin, {
      purpose: 'application_logo',
      file: new File([webpBytes()], 'logo.webp', { type: 'image/webp' }),
      actorUserId: 'admin-1',
    })

    expect(storage.put).toHaveBeenNthCalledWith(1, expect.any(String), expect.any(ArrayBuffer), {
      httpMetadata: { contentType: 'image/jpeg' },
    })
    expect(storage.put).toHaveBeenNthCalledWith(2, expect.any(String), expect.any(ArrayBuffer), {
      httpMetadata: { contentType: 'image/webp' },
    })
  })

  it('fails fast for empty uploads and missing stored objects', async () => {
    const storage = { put: vi.fn(), get: vi.fn().mockResolvedValue(null) }
    const repository = createRepository()
    repository.findAsset = vi.fn().mockResolvedValue({
      id: 'asset-1',
      purpose: 'avatar',
      storageKey: 'avatar/aa/asset-1-avatar.png',
      publicUrl: '/api/assets/asset-1',
      contentType: 'image/png',
      byteSize: 6,
      checksumSha256: 'checksum-1',
      createdByUserId: 'user-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    const deps = depsWith(repository, storage)

    await expect(
      uploadAsset(deps, origin, {
        purpose: 'avatar',
        file: new File([], 'avatar.png', { type: 'image/png' }),
        actorUserId: 'user-1',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Upload file is required.' })

    await expect(getAssetObject(deps, 'asset-1')).rejects.toMatchObject({
      status: 404,
      message: 'Asset object was not found.',
    })
  })

  it('returns stored objects and updates owning records through the repository', async () => {
    const asset = {
      id: 'asset-1',
      purpose: 'application_logo' as const,
      storageKey: 'application_logo/aa/asset-1-logo.png',
      publicUrl: '/api/assets/asset-1',
      contentType: 'image/png',
      byteSize: 4,
      checksumSha256: 'checksum-1',
      createdByUserId: 'admin-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    const repository = createRepository()
    repository.findAsset = vi.fn().mockResolvedValue(asset)
    const object = { body: 'logo' } as unknown as R2ObjectBody
    const deps = depsWith(repository, { put: vi.fn(), get: vi.fn().mockResolvedValue(object) })

    await expect(getAssetObject(deps, 'asset-1')).resolves.toEqual({ asset, object })
    await updateUserAvatar(deps, 'user-1', responseAsset())
    await updateApplicationLogo(deps, 'app-1', responseAsset())
    await updateOrganizationLogo(deps, 'org-1', responseAsset())
    await updateBrandingAsset(deps, 'logo', responseAsset())

    expect(repository.updateUserAvatar).toHaveBeenCalledWith('user-1', 'asset-1', '/api/assets/asset-1')
    expect(repository.updateApplicationLogo).toHaveBeenCalledWith('app-1', 'asset-1', '/api/assets/asset-1')
    expect(repository.updateOrganizationLogo).toHaveBeenCalledWith('org-1', 'asset-1', '/api/assets/asset-1')
    expect(repository.updateBrandingAsset).toHaveBeenCalledWith('logo', 'asset-1')
  })

  it('surfaces missing asset metadata before reading R2', async () => {
    const storage = { put: vi.fn(), get: vi.fn() }
    const deps = depsWith(createRepository(), storage)

    await expect(getAssetObject(deps, 'missing')).rejects.toMatchObject({
      status: 404,
      message: 'Asset was not found.',
    })
    expect(storage.get).not.toHaveBeenCalled()
  })
})

function createRepository(): AssetRepository {
  return {
    createAsset: vi.fn(async (input) => ({ ...input, createdAt: new Date('2026-01-01T00:00:00.000Z') })),
    findAsset: vi.fn(),
    updateUserAvatar: vi.fn(),
    updateApplicationLogo: vi.fn(),
    updateOrganizationLogo: vi.fn(),
    updateBrandingAsset: vi.fn(),
  }
}

function pngBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

function icoBytes() {
  return new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00])
}

function jpegBytes() {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
}

function webpBytes() {
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
}

function responseAsset() {
  return {
    id: 'asset-1',
    purpose: 'application_logo' as const,
    publicUrl: '/api/assets/asset-1',
    contentType: 'image/png',
    byteSize: 4,
    checksumSha256: 'checksum-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}
