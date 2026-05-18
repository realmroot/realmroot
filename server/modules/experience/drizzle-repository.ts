import type { SQL } from 'drizzle-orm'
import { eq, isNull } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  application,
  brandingSetting,
  identityProviderConnector,
  oauthClient,
  signInExperience,
  uploadedAsset,
} from '../../db/schema'
import type { ExperienceIdentityProvider, ExperienceRepository, ExperienceSettings } from './service'

export function createDrizzleExperienceRepository(db: Database): ExperienceRepository {
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

      return findBranding(db, isNull(brandingSetting.applicationId))
    },

    async listEnabledIdentityProviders() {
      const rows = await db.select().from(identityProviderConnector).where(eq(identityProviderConnector.enabled, true))
      return rows.map(toIdentityProvider)
    },

    async findApplicationByClientId(clientId) {
      const rows = await db
        .select({ application, oauthClient })
        .from(application)
        .innerJoin(oauthClient, eq(application.oauthClientId, oauthClient.clientId))
        .where(eq(oauthClient.clientId, clientId))
        .limit(1)

      const row = rows[0]
      return row
        ? {
            id: row.application.id,
            clientId: row.oauthClient.clientId,
            redirectUris: parseList(row.oauthClient.redirectUris),
            disabled: row.application.disabled || !!row.oauthClient.disabled,
          }
        : null
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

function toSettings(row: SignInExperienceRow): ExperienceSettings {
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

function toIdentityProvider(row: IdentityProviderConnectorRow): ExperienceIdentityProvider {
  return {
    slug: row.slug,
    providerType: row.providerType,
    providerId: row.providerId,
    displayName: row.displayName,
  }
}

function parseList(value: string | null): string[] {
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}
