import type { SQL } from 'drizzle-orm'
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { brandingSetting, identityProviderConnector, signInExperience, uploadedAsset } from '../../db/schema'
import { connectorTemplates } from '../connectors/provider-templates'
import type {
  ConfigzIdentityProvider,
  ConfigzRepository,
  ConfigzSettings,
  UpdateConfigzBrandingInput,
  UpdateConfigzSettingsInput,
} from './service'

const settingsId = 'default'
const globalBrandingId = 'branding_default'

export function createDrizzleConfigzRepository(db: Database): ConfigzRepository {
  return {
    async getSettings() {
      const rows = await db.select().from(signInExperience).where(eq(signInExperience.id, settingsId)).limit(1)
      if (rows[0]) return toSettings(rows[0])

      const legacyRows = await db.select().from(signInExperience).limit(1)
      return legacyRows[0] ? toSettings(legacyRows[0]) : null
    },

    async updateSettings(input) {
      const current = await this.getSettings()
      const patch = toSettingsPatch(input, current?.metadata ?? null)
      await db
        .insert(signInExperience)
        .values({ ...settingsInsertDefaults(current), id: settingsId, ...patch })
        .onConflictDoUpdate({
          target: signInExperience.id,
          set: patch,
        })
    },

    async updateBranding(input) {
      if (input.copy) await this.updateSettings({ copy: input.copy })

      const patch = toBrandingPatch(input)
      await db
        .insert(brandingSetting)
        .values({ id: globalBrandingId, ...patch })
        .onConflictDoUpdate({
          target: brandingSetting.id,
          set: patch,
        })
    },

    async getBranding(applicationId) {
      const applicationBranding = applicationId
        ? await findBranding(db, eq(brandingSetting.applicationId, applicationId))
        : null
      if (applicationBranding) return applicationBranding

      return (
        (await findBranding(db, eq(brandingSetting.id, globalBrandingId))) ??
        findBranding(db, and(isNull(brandingSetting.applicationId), isNull(brandingSetting.organizationId))!)
      )
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

  let faviconAssetUrl: string | null = null
  if (row.branding.faviconAssetId) {
    const faviconRows = await db
      .select({ publicUrl: uploadedAsset.publicUrl })
      .from(uploadedAsset)
      .where(eq(uploadedAsset.id, row.branding.faviconAssetId))
      .limit(1)
    faviconAssetUrl = faviconRows[0]?.publicUrl ?? null
  }

  return {
    logoUrl: row.branding.logoUrl,
    logoAssetUrl: row.logo,
    faviconUrl: row.branding.faviconUrl,
    faviconAssetUrl,
    primaryColor: row.branding.primaryColor,
    backgroundColor: row.branding.backgroundColor,
    customCss: row.branding.customCss,
  }
}

function toSettingsPatch(input: UpdateConfigzSettingsInput, metadata: Record<string, unknown> | null) {
  return withoutUndefined({
    passwordEnabled: input.passwordEnabled,
    signupEnabled: input.signupEnabled,
    socialLoginEnabled: input.socialLoginEnabled,
    identifierFirst: input.identifierFirst,
    defaultApplicationId: input.defaultApplicationId,
    defaultRedirectUri: input.defaultRedirectUri,
    termsUri: input.termsUri,
    privacyUri: input.privacyUri,
    supportEmail: input.supportEmail,
    metadata: input.copy ? { ...(metadata ?? {}), copy: { ...readCopyMetadata(metadata), ...input.copy } } : undefined,
    updatedAt: new Date(),
  })
}

function settingsInsertDefaults(settings: ConfigzSettings | null) {
  return {
    defaultApplicationId: settings?.defaultApplicationId ?? null,
    passwordEnabled: settings?.passwordEnabled ?? true,
    signupEnabled: settings?.signupEnabled ?? true,
    socialLoginEnabled: settings?.socialLoginEnabled ?? true,
    identifierFirst: settings?.identifierFirst ?? false,
    defaultRedirectUri: settings?.defaultRedirectUri ?? null,
    termsUri: settings?.termsUri ?? null,
    privacyUri: settings?.privacyUri ?? null,
    supportEmail: settings?.supportEmail ?? null,
    metadata: settings?.metadata ?? null,
  }
}

function toBrandingPatch(input: UpdateConfigzBrandingInput) {
  return withoutUndefined({
    applicationId: null,
    organizationId: null,
    logoUrl: input.logoUrl,
    faviconUrl: input.faviconUrl,
    primaryColor: input.primaryColor,
    backgroundColor: input.backgroundColor,
    customCss: input.customCss,
    updatedAt: new Date(),
  })
}

function readCopyMetadata(metadata: Record<string, unknown> | null) {
  return metadata && typeof metadata.copy === 'object' && metadata.copy !== null
    ? (metadata.copy as Record<string, unknown>)
    : {}
}

function withoutUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T as undefined extends T[K] ? K : K]: Exclude<T[K], undefined>
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
    icon: connectorTemplates.find((template) => template.providerId === row.providerId)?.icon ?? 'oauth',
  }
}
