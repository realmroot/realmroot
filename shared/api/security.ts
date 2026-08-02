import { z } from 'zod'

export const mfaPolicyModeSchema = z.enum(['optional', 'required'])

export const mfaPolicySchema = z.object({
  mode: mfaPolicyModeSchema,
  authenticatorAppEnabled: z.boolean().optional(),
  emailOtpEnabled: z.boolean().optional(),
  backupCodesEnabled: z.boolean().optional(),
})

export const passwordPolicySchema = z.object({
  minLength: z.number().int().min(8).max(128),
  requiredCharacterTypes: z.number().int().min(1).max(4),
  customWords: z.array(z.string().trim().min(1).max(80)).max(50),
  rejectUserInfo: z.boolean(),
  rejectSequential: z.boolean(),
  rejectCustomWords: z.boolean(),
})

export const captchaProviderSchema = z.enum(['turnstile', 'hcaptcha', 'recaptcha-enterprise'])

const captchaConfigurationSchema = z.object({
  enabled: z.boolean(),
  provider: captchaProviderSchema,
  siteKey: z.string().trim().max(200),
  projectId: z.string().trim().max(200).nullable(),
})

export const captchaPolicySchema = captchaConfigurationSchema
  .extend({
    secretKey: z.string().trim().max(500),
    legacySecretBinding: z.string().trim().max(80).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) return
    if (!value.siteKey) ctx.addIssue({ code: 'custom', path: ['siteKey'], message: 'Site key is required.' })
    if (!value.secretKey && !value.legacySecretBinding) {
      ctx.addIssue({ code: 'custom', path: ['secretKey'], message: 'Secret key is required.' })
    }
    if (value.provider === 'recaptcha-enterprise' && !value.projectId) {
      ctx.addIssue({ code: 'custom', path: ['projectId'], message: 'Project ID is required.' })
    }
  })

export const captchaPolicyResponseSchema = captchaConfigurationSchema.extend({
  secretConfigured: z.boolean(),
})

export const blocklistPolicySchema = z.object({
  blockSubaddressing: z.boolean(),
  entries: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .min(1)
        .max(255)
        .refine(isEmailOrDomain, 'Entry must be an email address or bare domain.'),
    )
    .max(200),
})

export const securityPolicySchema = z.object({
  mfa: mfaPolicySchema,
  passkeys: z.object({
    enabled: z.boolean(),
    rpId: z.string().min(1),
    rpName: z.string().min(1),
    origins: z.array(z.string().url()).min(1),
  }),
  sessions: z.object({
    expiresInSeconds: z.number().int().positive(),
    updateAgeSeconds: z.number().int().nonnegative(),
    freshAgeSeconds: z.number().int().nonnegative(),
    cookieCacheSeconds: z.number().int().positive(),
  }),
  password: passwordPolicySchema,
  captcha: captchaPolicySchema,
  blocklist: blocklistPolicySchema,
})

export const securityPolicyResponseSchema = securityPolicySchema.extend({
  captcha: captchaPolicyResponseSchema,
})

const managedSessionPolicySchema = securityPolicySchema.shape.sessions.superRefine((value, ctx) => {
  if (value.updateAgeSeconds > value.expiresInSeconds) {
    ctx.addIssue({
      code: 'custom',
      path: ['updateAgeSeconds'],
      message: 'Refresh interval cannot exceed session lifetime.',
    })
  }
  if (value.freshAgeSeconds > value.expiresInSeconds) {
    ctx.addIssue({
      code: 'custom',
      path: ['freshAgeSeconds'],
      message: 'Fresh authentication window cannot exceed session lifetime.',
    })
  }
})

export const updateSecurityPolicySchema = z.object({
  policy: z.object({
    mfa: mfaPolicySchema.partial().optional(),
    passkeys: securityPolicySchema.shape.passkeys.partial().optional(),
    password: passwordPolicySchema.optional(),
    sessions: managedSessionPolicySchema.optional(),
    captcha: captchaConfigurationSchema
      .extend({ secretKey: z.string().trim().max(500).optional() })
      .superRefine((value, ctx) => {
        if (!value.enabled) return
        if (!value.siteKey) ctx.addIssue({ code: 'custom', path: ['siteKey'], message: 'Site key is required.' })
        if (value.provider === 'recaptcha-enterprise' && !value.projectId) {
          ctx.addIssue({ code: 'custom', path: ['projectId'], message: 'Project ID is required.' })
        }
      })
      .optional(),
    blocklist: blocklistPolicySchema.optional(),
  }),
})

export const securityTotpEnrollmentSchema = z.object({
  password: z.string().min(1).optional(),
  issuer: z.string().min(1).optional(),
})

export const securityTotpDisableSchema = z.object({
  password: z.string().min(1).optional(),
})

export const securityTotpVerificationSchema = z.object({
  code: z.string().min(1),
  trustDevice: z.boolean().optional(),
})

export const securityBackupCodesRequestSchema = z.object({
  password: z.string().min(1).optional(),
})

export const securityPasskeyUpdateSchema = z.object({
  name: z.string().min(1).max(100),
})

export const securityPasskeyRegistrationOptionsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  context: z.string().optional(),
})

export const securityPasskeyVerificationSchema = z.record(z.string(), z.unknown())

export type SecurityPolicy = z.infer<typeof securityPolicySchema>
export type UpdateSecurityPolicyInput = z.infer<typeof updateSecurityPolicySchema>
export type SecurityPolicyResponse = z.infer<typeof securityPolicyResponseSchema>
export type SecurityTotpEnrollmentInput = z.infer<typeof securityTotpEnrollmentSchema>
export type SecurityTotpDisableInput = z.infer<typeof securityTotpDisableSchema>
export type SecurityTotpVerificationInput = z.infer<typeof securityTotpVerificationSchema>
export type SecurityBackupCodesInput = z.infer<typeof securityBackupCodesRequestSchema>
export type SecurityPasskeyUpdateInput = z.infer<typeof securityPasskeyUpdateSchema>
export type SecurityPasskeyRegistrationOptionsInput = z.infer<typeof securityPasskeyRegistrationOptionsSchema>
export type SecurityPasskeyVerificationInput = z.infer<typeof securityPasskeyVerificationSchema>

export type PasskeysResponse = {
  passkeys: Array<{
    id: string
    name: string | null
    deviceType: string
    backedUp: boolean
    createdAt: string | null
  }>
}

function isEmailOrDomain(value: string) {
  if (value.includes('@')) return z.email().safeParse(value).success
  if (value.includes('/') || value.includes(':')) return false
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(value)
}
