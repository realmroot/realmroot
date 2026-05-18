import { z } from 'zod'
import { usernameSchema } from './users'

const optionalCallbackUrlSchema = z.string().min(1).optional()
const nullableUrlSchema = z.string().nullable()

export const experienceMethodSchema = z.object({
  passwordEnabled: z.boolean(),
  signupEnabled: z.boolean(),
  socialLoginEnabled: z.boolean(),
  magicLinkEnabled: z.boolean(),
  emailOtpEnabled: z.boolean(),
  usernameEnabled: z.boolean(),
  identifierFirst: z.boolean(),
})

export const experienceBrandingSchema = z.object({
  logoUrl: nullableUrlSchema,
  faviconUrl: nullableUrlSchema,
  primaryColor: z.string().nullable(),
  backgroundColor: z.string().nullable(),
  customCss: z.string().nullable(),
})

export const experienceIdentityProviderSchema = z.object({
  slug: z.string(),
  providerType: z.string(),
  displayName: z.string(),
  authorizationUrl: z.string(),
})

export const experienceConfigResponseSchema = z.object({
  signIn: experienceMethodSchema,
  branding: experienceBrandingSchema,
  identityProviders: z.array(experienceIdentityProviderSchema),
  links: z.object({
    termsUri: nullableUrlSchema,
    privacyUri: nullableUrlSchema,
    supportEmail: z.string().nullable(),
  }),
  copy: z.object({
    productName: z.string(),
    headline: z.string(),
    description: z.string(),
  }),
  defaults: z.object({
    applicationId: z.string().nullable(),
    redirectUri: z.string().nullable(),
  }),
})

export const experienceCallbackQuerySchema = z.object({
  client_id: z.string().trim().min(1).optional(),
  redirect_uri: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
  error_description: z.string().trim().min(1).optional(),
  return_to: z.string().trim().min(1).optional(),
})

export const experienceCallbackResponseSchema = z.object({
  state: z.string().nullable(),
  returnTo: z.string().nullable(),
  error: z
    .object({
      code: z.string(),
      description: z.string().nullable(),
    })
    .nullable(),
  consent: z
    .object({
      clientId: z.string(),
      redirectUri: z.string(),
      href: z.string(),
    })
    .nullable(),
})

export const passwordSignInRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  callbackURL: optionalCallbackUrlSchema,
  rememberMe: z.boolean().optional(),
})

export const usernameSignInRequestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1),
  callbackURL: optionalCallbackUrlSchema,
  rememberMe: z.boolean().optional(),
})

export const signUpRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().trim().min(1),
  username: usernameSchema.optional(),
  callbackURL: optionalCallbackUrlSchema,
  rememberMe: z.boolean().optional(),
})

export const passwordResetRequestSchema = z.object({
  email: z.email(),
  redirectTo: optionalCallbackUrlSchema,
})

export const passwordResetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
})

export const emailVerificationRequestSchema = z.object({
  email: z.email(),
  callbackURL: optionalCallbackUrlSchema,
})

export const emailVerificationSchema = z.object({
  token: z.string().min(1),
  callbackURL: optionalCallbackUrlSchema,
})

export const magicLinkRequestSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).optional(),
  callbackURL: optionalCallbackUrlSchema,
  newUserCallbackURL: optionalCallbackUrlSchema,
  errorCallbackURL: optionalCallbackUrlSchema,
})

export const emailOtpTypeSchema = z.enum(['sign-in', 'email-verification', 'forget-password'])

export const emailOtpRequestSchema = z.object({
  email: z.email(),
  type: emailOtpTypeSchema,
})

export const emailOtpSignInSchema = z.object({
  email: z.email(),
  otp: z.string().min(1),
  name: z.string().trim().min(1).optional(),
})

export const emailOtpVerificationSchema = z.object({
  email: z.email(),
  otp: z.string().min(1),
})

export const emailOtpPasswordResetRequestSchema = z.object({
  email: z.email(),
})

export const emailOtpPasswordResetSchema = z.object({
  email: z.email(),
  otp: z.string().min(1),
  password: z.string().min(8),
})

export const usernameAvailabilityRequestSchema = z.object({
  username: usernameSchema,
})

export type ExperienceConfigResponse = z.infer<typeof experienceConfigResponseSchema>
export type ExperienceCallbackQuery = z.infer<typeof experienceCallbackQuerySchema>
export type ExperienceCallbackResponse = z.infer<typeof experienceCallbackResponseSchema>
