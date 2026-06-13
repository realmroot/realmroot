import { connectorTemplates } from '@server/domain/connectors/provider-templates'
import { defaultAccountCenterSettings } from '@server/usecases/configz'
import type {
  ConfigzIdentityProvider,
  ConfigzRepository,
  ConfigzSettings,
  UpdateConfigzBrandingInput,
  UpdateConfigzSettingsInput,
} from '@server/usecases/ports'
import type { SQL } from 'drizzle-orm'
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  accountCenterSetting,
  brandingSetting,
  identityProviderConnector,
  signInExperience,
  uploadedAsset,
} from '../../db/schema'

const settingsId = 'default'
const globalBrandingId = 'branding_default'
const accountCenterSettingsId = 'account_center_default'

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

    async getAccountCenterSettings() {
      const rows = await db
        .select()
        .from(accountCenterSetting)
        .where(eq(accountCenterSetting.id, accountCenterSettingsId))
        .limit(1)
      return rows[0] ? toAccountCenterSettings(rows[0]) : null
    },

    async updateAccountCenterSettings(input) {
      const current = (await this.getAccountCenterSettings()) ?? defaultAccountCenterSettings
      const next = { ...current, ...input }
      const patch = toAccountCenterPatch(input, current)
      await db
        .insert(accountCenterSetting)
        .values({
          id: accountCenterSettingsId,
          applicationId: null,
          profileEditingEnabled: next.profileEditingEnabled,
          passwordChangeEnabled: next.passwordChangeEnabled,
          connectedAccountsEnabled: next.connectedAccountsEnabled,
          sessionsViewEnabled: next.sessionsViewEnabled,
          dangerZoneEnabled: next.dangerZoneEnabled,
          metadata: accountCenterMetadata(next),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: accountCenterSetting.id,
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
  const nextMetadata =
    input.copy || input.builtInProviders || input.emailOtpEnabled !== undefined
      ? {
          ...(metadata ?? {}),
          ...(input.copy ? { copy: { ...readCopyMetadata(metadata), ...input.copy } } : {}),
          ...(input.builtInProviders
            ? {
                builtInProviders: {
                  ...mergeBuiltInProviderMetadata(
                    readObjectMetadata(metadata, 'builtInProviders'),
                    input.builtInProviders,
                  ),
                },
              }
            : {}),
          ...(input.emailOtpEnabled !== undefined ? { emailOtpEnabled: input.emailOtpEnabled } : {}),
        }
      : undefined

  return withoutUndefined({
    passwordEnabled: input.passwordEnabled,
    signupEnabled: input.signupEnabled,
    socialLoginEnabled: input.socialLoginEnabled,
    identifierFirst: input.identifierFirst,
    termsUri: input.termsUri,
    privacyUri: input.privacyUri,
    supportEmail: input.supportEmail,
    metadata: nextMetadata,
    updatedAt: new Date(),
  })
}

function mergeBuiltInProviderMetadata(
  current: Record<string, unknown>,
  patch: NonNullable<UpdateConfigzSettingsInput['builtInProviders']>,
) {
  return Object.fromEntries(
    [...new Set([...Object.keys(current), ...Object.keys(patch)])].map((key) => {
      const currentValue = current[key]
      const patchValue = patch[key as keyof typeof patch]
      if (isPlainObject(currentValue) && isPlainObject(patchValue)) return [key, { ...currentValue, ...patchValue }]
      return [key, patchValue ?? currentValue]
    }),
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function settingsInsertDefaults(settings: ConfigzSettings | null) {
  return {
    passwordEnabled: settings?.passwordEnabled ?? true,
    signupEnabled: settings?.signupEnabled ?? true,
    socialLoginEnabled: settings?.socialLoginEnabled ?? true,
    identifierFirst: settings?.identifierFirst ?? false,
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

function toAccountCenterPatch(
  input: Partial<typeof defaultAccountCenterSettings>,
  current: typeof defaultAccountCenterSettings,
) {
  const profileMetadata = accountCenterMetadata({ ...current, ...input })
  return withoutUndefined({
    profileEditingEnabled: input.profileEditingEnabled,
    passwordChangeEnabled: input.passwordChangeEnabled,
    connectedAccountsEnabled: input.connectedAccountsEnabled,
    sessionsViewEnabled: input.sessionsViewEnabled,
    dangerZoneEnabled: input.dangerZoneEnabled,
    metadata:
      input.displayNameEditable === undefined &&
      input.usernameEditable === undefined &&
      input.avatarEditable === undefined &&
      input.emailChangeEnabled === undefined
        ? undefined
        : profileMetadata,
    updatedAt: new Date(),
  })
}

function accountCenterMetadata(settings: typeof defaultAccountCenterSettings) {
  return {
    fieldPermissions: {
      displayNameEditable: settings.displayNameEditable,
      usernameEditable: settings.usernameEditable,
      avatarEditable: settings.avatarEditable,
      emailChangeEnabled: settings.emailChangeEnabled,
    },
  }
}

function readCopyMetadata(metadata: Record<string, unknown> | null) {
  return metadata && typeof metadata.copy === 'object' && metadata.copy !== null
    ? (metadata.copy as Record<string, unknown>)
    : {}
}

function readObjectMetadata(metadata: Record<string, unknown> | null, key: string) {
  return metadata && typeof metadata[key] === 'object' && metadata[key] !== null
    ? (metadata[key] as Record<string, unknown>)
    : {}
}

function withoutUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T as undefined extends T[K] ? K : K]: Exclude<T[K], undefined>
  }
}

type SignInExperienceRow = typeof signInExperience.$inferSelect
type IdentityProviderConnectorRow = typeof identityProviderConnector.$inferSelect
type AccountCenterSettingRow = typeof accountCenterSetting.$inferSelect

function toSettings(row: SignInExperienceRow): ConfigzSettings {
  return {
    passwordEnabled: row.passwordEnabled,
    signupEnabled: row.signupEnabled,
    socialLoginEnabled: row.socialLoginEnabled,
    identifierFirst: row.identifierFirst,
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

function toAccountCenterSettings(row: AccountCenterSettingRow): typeof defaultAccountCenterSettings {
  const fieldPermissions = readFieldPermissions(row.metadata)
  return {
    profileEditingEnabled: row.profileEditingEnabled,
    displayNameEditable: fieldPermissions.displayNameEditable,
    usernameEditable: fieldPermissions.usernameEditable,
    avatarEditable: fieldPermissions.avatarEditable,
    emailChangeEnabled: fieldPermissions.emailChangeEnabled,
    passwordChangeEnabled: row.passwordChangeEnabled,
    connectedAccountsEnabled: row.connectedAccountsEnabled,
    sessionsViewEnabled: row.sessionsViewEnabled,
    dangerZoneEnabled: row.dangerZoneEnabled,
  }
}

function readFieldPermissions(metadata: Record<string, unknown> | null) {
  const value =
    metadata && typeof metadata.fieldPermissions === 'object' && metadata.fieldPermissions !== null
      ? (metadata.fieldPermissions as Record<string, unknown>)
      : {}
  return {
    displayNameEditable:
      typeof value.displayNameEditable === 'boolean'
        ? value.displayNameEditable
        : defaultAccountCenterSettings.displayNameEditable,
    usernameEditable:
      typeof value.usernameEditable === 'boolean'
        ? value.usernameEditable
        : defaultAccountCenterSettings.usernameEditable,
    avatarEditable:
      typeof value.avatarEditable === 'boolean' ? value.avatarEditable : defaultAccountCenterSettings.avatarEditable,
    emailChangeEnabled:
      typeof value.emailChangeEnabled === 'boolean'
        ? value.emailChangeEnabled
        : defaultAccountCenterSettings.emailChangeEnabled,
  }
}
