import { notFound } from '@server/domain/errors'
import type { AssetRepository, UploadedAssetRecord } from '@server/usecases/ports'
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { application, brandingSetting, oauthClient, organization, uploadedAsset, user } from '../../db/schema'
import { writeApplicationMetadata } from './applications-mappers'

export function createDrizzleAssetRepository(db: Database): AssetRepository {
  return {
    async createAsset(input) {
      const now = new Date()
      await db.insert(uploadedAsset).values({ ...input, createdAt: now })
      return { ...input, createdAt: now }
    },

    async findAsset(id) {
      const rows = await db.select().from(uploadedAsset).where(eq(uploadedAsset.id, id)).limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async updateUserAvatar(userId, assetId, publicUrl) {
      const rows = await db
        .update(user)
        .set({ avatarAssetId: assetId, image: publicUrl, updatedAt: new Date() })
        .where(eq(user.id, userId))
        .returning({ id: user.id })

      if (!rows[0]) {
        throw notFound('User not found.')
      }
    },

    async updateApplicationLogo(applicationId, assetId, publicUrl) {
      const rows = await db.select().from(application).where(eq(application.id, applicationId)).limit(1)
      const current = rows[0]
      if (!current) {
        throw notFound('Application was not found.')
      }

      await db.batch([
        db
          .update(application)
          .set({
            logoAssetId: assetId,
            metadata: writeApplicationMetadata(current.metadata, { iconUrl: publicUrl }),
            updatedAt: new Date(),
          })
          .where(eq(application.id, applicationId)),
        db
          .update(oauthClient)
          .set({ icon: publicUrl, updatedAt: new Date() })
          .where(eq(oauthClient.clientId, current.oauthClientId)),
      ])
    },

    async updateOrganizationLogo(organizationId, assetId, publicUrl) {
      const rows = await db
        .update(organization)
        .set({ logoAssetId: assetId, logo: publicUrl, updatedAt: new Date() })
        .where(eq(organization.id, organizationId))
        .returning({ id: organization.id })

      if (!rows[0]) {
        throw notFound('Organization was not found.')
      }
    },

    async updateBrandingAsset(kind, assetId) {
      const rows = await db
        .select({ id: brandingSetting.id })
        .from(brandingSetting)
        .where(and(isNull(brandingSetting.applicationId), isNull(brandingSetting.organizationId)))
        .limit(1)
      const patch = kind === 'logo' ? { logoAssetId: assetId } : { faviconAssetId: assetId }

      if (rows[0]) {
        await db
          .update(brandingSetting)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(brandingSetting.id, rows[0].id))
        return
      }

      await db.insert(brandingSetting).values({
        id: 'branding_default',
        ...patch,
        updatedAt: new Date(),
      })
    },
  }
}

function toRecord(row: typeof uploadedAsset.$inferSelect): UploadedAssetRecord {
  return {
    id: row.id,
    purpose: row.purpose as UploadedAssetRecord['purpose'],
    storageKey: row.storageKey,
    publicUrl: row.publicUrl ?? `/api/assets/${row.id}`,
    contentType: row.contentType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256 ?? '',
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  }
}
