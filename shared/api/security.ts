import { z } from 'zod'

export const mfaPolicyModeSchema = z.enum(['optional', 'required'])

export const passwordPolicySchema = z.object({
  minLength: z.number().int().min(8).max(128),
  requiredCharacterTypes: z.number().int().min(1).max(4),
  customWords: z.array(z.string().trim().min(1).max(80)).max(50),
  rejectUserInfo: z.boolean(),
  rejectSequential: z.boolean(),
  rejectCustomWords: z.boolean(),
})

export const captchaPolicySchema = z
  .object({
    enabled: z.boolean(),
    provider: z.literal('turnstile'),
    siteKey: z.string().trim().max(200),
    secretBinding: z.string().trim().max(80),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) return
    if (!value.siteKey) ctx.addIssue({ code: 'custom', path: ['siteKey'], message: 'Site key is required.' })
    if (!value.secretBinding) {
      ctx.addIssue({ code: 'custom', path: ['secretBinding'], message: 'Secret binding is required.' })
    }
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
  mfa: z.object({
    mode: mfaPolicyModeSchema,
  }),
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

export const updateSecurityPolicySchema = z.object({
  policy: securityPolicySchema
    .pick({
      mfa: true,
      password: true,
      captcha: true,
      blocklist: true,
    })
    .partial(),
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

export const securityOtpRequestSchema = z.object({
  trustDevice: z.boolean().optional(),
})

export const securityOtpVerificationSchema = z.object({
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
export type SecurityTotpEnrollmentInput = z.infer<typeof securityTotpEnrollmentSchema>
export type SecurityTotpDisableInput = z.infer<typeof securityTotpDisableSchema>
export type SecurityTotpVerificationInput = z.infer<typeof securityTotpVerificationSchema>
export type SecurityOtpRequestInput = z.infer<typeof securityOtpRequestSchema>
export type SecurityOtpVerificationInput = z.infer<typeof securityOtpVerificationSchema>
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
