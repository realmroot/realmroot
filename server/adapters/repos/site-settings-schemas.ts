import { configzAccountCenterSchema } from '@shared/api/configz'
import { emailServiceSettingsSchema } from '@shared/api/management'
import { z } from 'zod'

export const metadataSchema = z.record(z.string(), z.unknown())
export const generalSettingsSchema = z
  .object({
    termsUri: z.string().nullable().default(null),
    privacyUri: z.string().nullable().default(null),
    supportEmail: z.string().nullable().default(null),
    supportUri: z.string().nullable().default(null),
    copy: metadataSchema.default({}),
  })
  .passthrough()
export const signInSettingsSchema = z.object({
  passwordEnabled: z.boolean(),
  signupEnabled: z.boolean(),
  socialLoginEnabled: z.boolean(),
  identifierFirst: z.boolean(),
  metadata: metadataSchema,
})
export const accountSettingsSchema = configzAccountCenterSchema.extend({ metadata: metadataSchema.optional() })
export const brandingSettingsSchema = z.object({
  logoUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  logoAssetId: z.string().nullable(),
  faviconAssetId: z.string().nullable(),
  primaryColor: z.string().nullable(),
  backgroundColor: z.string().nullable(),
  customCss: z.string().nullable(),
})
export const storedEmailSettingsSchema = emailServiceSettingsSchema.extend({
  defaultLocale: z.string().nullable().optional(),
  metadata: metadataSchema.nullable().optional(),
})
