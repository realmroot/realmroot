import type { SQL } from 'drizzle-orm'
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { brandingSetting, identityProviderConnector, signInExperience, uploadedAsset } from '../../db/schema'
import type { ConfigzIdentityProvider, ConfigzRepository, ConfigzSettings } from './service'

export function createDrizzleConfigzRepository(db: Database): ConfigzRepository {
  return {
    async getSettings() {
      const rows = await db.select().from(signInExperience).limit(1)
      return rows[0] ? toSettings(rows[0]) : null
    },

    async getBranding(applicationId) {
      const applicationBranding = applicationId
        ? await findBranding(db, eq(brandingSetting.applicationId, applicationId))
        : null
      if (applicationBranding) return applicationBranding

      return findBranding(db, and(isNull(brandingSetting.applicationId), isNull(brandingSetting.organizationId))!)
    },

    async listEnabledIdentityProviders() {
      const rows = await db.select().from(identityProviderConnector).where(eq(identityProviderConnector.enabled, true))
      return rows.map(toIdentityProvider)
    },
  }
}

async function findBranding(db: Database, where: SQL) {
  const rows = await db
    .select({
      branding: brandingSetting,
      logo: uploadedAsset.publicUrl,
    })
    .from(brandingSetting)
    .leftJoin(uploadedAsset, eq(brandingSetting.logoAssetId, uploadedAsset.id))
    .where(where)
    .limit(1)

  const row = rows[0]
  if (!row) return null

  let faviconUrl: string | null = null
  if (row.branding.faviconAssetId) {
    const faviconRows = await db
      .select({ publicUrl: uploadedAsset.publicUrl })
      .from(uploadedAsset)
      .where(eq(uploadedAsset.id, row.branding.faviconAssetId))
      .limit(1)
    faviconUrl = faviconRows[0]?.publicUrl ?? null
  }

  return {
    logoUrl: row.logo,
    faviconUrl,
    primaryColor: row.branding.primaryColor,
    backgroundColor: row.branding.backgroundColor,
    customCss: row.branding.customCss,
  }
}

type SignInExperienceRow = typeof signInExperience.$inferSelect
type IdentityProviderConnectorRow = typeof identityProviderConnector.$inferSelect

function toSettings(row: SignInExperienceRow): ConfigzSettings {
  return {
    defaultApplicationId: row.defaultApplicationId,
    passwordEnabled: row.passwordEnabled,
    signupEnabled: row.signupEnabled,
    socialLoginEnabled: row.socialLoginEnabled,
    identifierFirst: row.identifierFirst,
    defaultRedirectUri: row.defaultRedirectUri,
    termsUri: row.termsUri,
    privacyUri: row.privacyUri,
    supportEmail: row.supportEmail,
    metadata: row.metadata ?? null,
  }
}

function toIdentityProvider(row: IdentityProviderConnectorRow): ConfigzIdentityProvider {
  return {
    slug: row.slug,
    providerType: row.providerType,
    providerId: row.providerId,
    displayName: row.displayName,
  }
}
