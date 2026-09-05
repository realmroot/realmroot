import { connectorTemplates } from '@server/domain/connectors/provider-templates'
import { defaultAccountCenterSettings } from '@server/usecases/configz'
import type {
  ConfigzIdentityProvider,
  ConfigzRepository,
  UpdateConfigzBrandingInput,
  UpdateConfigzSettingsInput,
} from '@server/usecases/ports'
import {
  developerConsoleAccessPolicyResponseSchema,
  emailServiceSettingsSchema,
  organizationCreationPolicyResponseSchema,
} from '@shared/api/management'
import { siteNavigationSchema } from '@shared/api/navigation'
import { eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { identityProviderConnector, organization, uploadedAsset } from '../../db/schema'

import { readSiteSettings, writeSiteSettings } from './site-settings'
import {
  accountSettingsSchema,
  brandingSettingsSchema,
  generalSettingsSchema,
  metadataSchema,
  signInSettingsSchema,
  storedEmailSettingsSchema,
} from './site-settings-schemas'

export function createDrizzleConfigzRepository(db: Database): ConfigzRepository {
  return {
    async getNavigation() {
      const row = await readSiteSettings(db, 'navigation', siteNavigationSchema)
      return { ...(row?.value ?? { externalLinks: [] }), revision: row?.revision ?? 0 }
    },
    async replaceNavigation(input, revision) {
      await writeSiteSettings(db, 'navigation', siteNavigationSchema.parse(input), revision === 0 ? null : revision)
    },
    async getSettings() {
      const signIn = await readSiteSettings(db, 'sign_in', signInSettingsSchema)
      const general = await readSiteSettings(db, 'general', generalSettingsSchema)
      if (!signIn && !general) return null
      const value = general?.value ?? generalSettingsSchema.parse({})
      return {
        passwordEnabled: signIn?.value.passwordEnabled ?? true,
        signupEnabled: signIn?.value.signupEnabled ?? true,
        socialLoginEnabled: signIn?.value.socialLoginEnabled ?? true,
        identifierFirst: signIn?.value.identifierFirst ?? false,
        termsUri: value.termsUri,
        privacyUri: value.privacyUri,
        supportEmail: value.supportEmail,
        metadata: { ...signIn?.value.metadata, copy: value.copy, supportUri: value.supportUri },
      }
    },

    async updateSettings(input) {
      const { copy, termsUri, privacyUri, supportEmail, supportUri, ...signInInput } = input
      if (Object.keys(signInInput).length) {
        const current = await readSiteSettings(db, 'sign_in', signInSettingsSchema)
        const value = current?.value ?? {
          passwordEnabled: true,
          signupEnabled: true,
          socialLoginEnabled: true,
          identifierFirst: false,
          metadata: {},
        }
        const patch = toSettingsPatch(signInInput, value.metadata)
        const { updatedAt: _updatedAt, ...next } = patch
        await writeSiteSettings(
          db,
          'sign_in',
          signInSettingsSchema.parse({ ...value, ...next }),
          current?.revision ?? null,
        )
      }
      if (
        copy !== undefined ||
        termsUri !== undefined ||
        privacyUri !== undefined ||
        supportEmail !== undefined ||
        supportUri !== undefined
      ) {
        const current = await readSiteSettings(db, 'general', generalSettingsSchema)
        const value = current?.value ?? generalSettingsSchema.parse({})
        const next = {
          ...value,
          ...withoutUndefined({ termsUri, privacyUri, supportEmail, supportUri }),
          ...(copy ? { copy: { ...value.copy, ...copy } } : {}),
        }
        await writeSiteSettings(db, 'general', generalSettingsSchema.parse(next), current?.revision ?? null)
      }
    },

    async updateBranding(input) {
      if (input.copy) await this.updateSettings({ copy: input.copy })
      const current = await readSiteSettings(db, 'branding', brandingSettingsSchema)
      const value = current?.value ?? emptyBranding
      const patch = toBrandingPatch(input)
      await writeSiteSettings(
        db,
        'branding',
        brandingSettingsSchema.parse({ ...value, ...patch }),
        current?.revision ?? null,
      )
    },

    async getAccountCenterSettings() {
      const row = await readSiteSettings(db, 'account_center', accountSettingsSchema)
      if (!row) return null
      const { metadata: _metadata, ...value } = row.value
      return value
    },

    async getOrganizationCreationPolicy() {
      const settings = await readSiteSettings(db, 'developer', metadataSchema)
      const configured = settings?.value ?? {}
      return organizationCreationPolicyResponseSchema.parse({
        mode: configured.organizationCreation ?? 'admins_only',
        approvedUserIds: configured.approvedUserIds ?? [],
      })
    },

    async getDeveloperConsoleAccessPolicy() {
      const settings = await readSiteSettings(db, 'developer', metadataSchema)
      const configured = settings?.value ?? {}
      const rows = await db.select({ id: organization.id, metadata: organization.metadata }).from(organization)
      return developerConsoleAccessPolicyResponseSchema.parse({
        mode: configured.consoleAccess ?? 'realm_operators',
        eligibleAccessLevels: configured.eligibleAccessLevels ?? ['owner', 'admin'],
        selectedOrganizationIds: rows
          .filter(
            (row) =>
              Array.isArray(configured.selectedOrganizationIds) && configured.selectedOrganizationIds.includes(row.id),
          )
          .map((row) => row.id)
          .sort(),
      })
    },

    async getEmailSettings() {
      const row = await readSiteSettings(db, 'email', storedEmailSettingsSchema)
      return row ? emailServiceSettingsSchema.parse(row.value) : null
    },

    async updateAccountCenterSettings(input) {
      const current = await readSiteSettings(db, 'account_center', accountSettingsSchema)
      const next = accountSettingsSchema.parse({ ...(current?.value ?? defaultAccountCenterSettings), ...input })
      await writeSiteSettings(db, 'account_center', next, current?.revision ?? null)
    },

    async updateOrganizationCreationPolicy(input) {
      const current = await readSiteSettings(db, 'developer', metadataSchema)
      await writeSiteSettings(
        db,
        'developer',
        {
          ...current?.value,
          organizationCreation: input.mode,
          approvedUserIds: input.mode === 'approved_users' ? input.approvedUserIds : [],
        },
        current?.revision ?? null,
      )
    },

    async updateDeveloperConsoleAccessPolicy(input) {
      const current = await readSiteSettings(db, 'developer', metadataSchema)
      await writeSiteSettings(
        db,
        'developer',
        {
          ...current?.value,
          consoleAccess: input.mode,
          eligibleAccessLevels: input.eligibleAccessLevels,
          selectedOrganizationIds: input.mode === 'selected_organizations' ? input.selectedOrganizationIds : [],
        },
        current?.revision ?? null,
      )
    },

    async updateEmailSettings(input) {
      const current = await readSiteSettings(db, 'email', storedEmailSettingsSchema)
      await writeSiteSettings(
        db,
        'email',
        storedEmailSettingsSchema.parse({ ...current?.value, ...input }),
        current?.revision ?? null,
      )
    },

    async getBranding(_applicationId) {
      const row = await readSiteSettings(db, 'branding', brandingSettingsSchema)
      if (!row) return null
      const { logoAssetId, faviconAssetId, ...value } = row.value
      async function assetUrl(id: string | null) {
        if (!id) return null
        const [asset] = await db
          .select({ publicUrl: uploadedAsset.publicUrl })
          .from(uploadedAsset)
          .where(eq(uploadedAsset.id, id))
          .limit(1)
        return asset?.publicUrl ?? null
      }
      return { ...value, logoAssetUrl: await assetUrl(logoAssetId), faviconAssetUrl: await assetUrl(faviconAssetId) }
    },

    async listEnabledIdentityProviders() {
      const rows = await db.select().from(identityProviderConnector).where(eq(identityProviderConnector.enabled, true))
      return rows.map(toIdentityProvider)
    },
  }
}

const emptyBranding = {
  logoUrl: null,
  faviconUrl: null,
  logoAssetId: null,
  faviconAssetId: null,
  primaryColor: null,
  backgroundColor: null,
  customCss: null,
}

function toSettingsPatch(input: UpdateConfigzSettingsInput, metadata: Record<string, unknown> | null) {
  const nextMetadata =
    input.copy ||
    input.builtInProviders ||
    input.emailOtpEnabled !== undefined ||
    input.usernameEnabled !== undefined ||
    input.supportUri !== undefined
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
          ...(input.usernameEnabled !== undefined ? { usernameEnabled: input.usernameEnabled } : {}),
          ...(input.supportUri !== undefined ? { supportUri: input.supportUri } : {}),
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

function toBrandingPatch(input: UpdateConfigzBrandingInput) {
  return withoutUndefined({
    applicationId: null,
    organizationId: null,
    logoAssetId: input.logoUrl === null ? null : undefined,
    faviconAssetId: input.faviconUrl === null ? null : undefined,
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

type IdentityProviderConnectorRow = typeof identityProviderConnector.$inferSelect

function toIdentityProvider(row: IdentityProviderConnectorRow): ConfigzIdentityProvider {
  return {
    slug: row.slug,
    providerType: row.providerType,
    providerId: row.providerId,
    displayName: row.displayName,
    icon: connectorTemplates.find((template) => template.providerId === row.providerId)?.icon ?? 'oauth',
  }
}
