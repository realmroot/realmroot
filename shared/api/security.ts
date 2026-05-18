import { z } from 'zod'

export const mfaPolicyModeSchema = z.enum(['optional', 'required'])

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
