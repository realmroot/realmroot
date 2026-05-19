import { z } from 'zod'

const nullableUrlSchema = z.string().nullable()
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const hostedCustomCssSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(isHostedCustomCss, 'Custom CSS only supports declaration-only --auth-* custom properties.')

export const configzMethodSchema = z.object({
  passwordEnabled: z.boolean(),
  signupEnabled: z.boolean(),
  socialLoginEnabled: z.boolean(),
  magicLinkEnabled: z.boolean(),
  emailOtpEnabled: z.boolean(),
  usernameEnabled: z.boolean(),
  identifierFirst: z.boolean(),
})

export const configzBrandingSchema = z.object({
  logoUrl: nullableUrlSchema,
  faviconUrl: nullableUrlSchema,
  primaryColor: hexColorSchema.nullable(),
  backgroundColor: hexColorSchema.nullable(),
  customCss: hostedCustomCssSchema.nullable(),
})

export const configzIdentityProviderSchema = z.object({
  slug: z.string(),
  providerType: z.string(),
  providerId: z.string(),
  displayName: z.string(),
})

export const configzConfigResponseSchema = z.object({
  onboarding: z.object({
    required: z.boolean(),
    href: z.string(),
  }),
  signIn: configzMethodSchema,
  branding: configzBrandingSchema,
  identityProviders: z.array(configzIdentityProviderSchema),
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
  auth: z.object({
    basePath: z.literal('/api/auth'),
    signInEmailPath: z.literal('/api/auth/sign-in/email'),
    signInUsernamePath: z.literal('/api/auth/sign-in/username'),
    signUpEmailPath: z.literal('/api/auth/sign-up/email'),
    signOutPath: z.literal('/api/auth/sign-out'),
    requestPasswordResetPath: z.literal('/api/auth/request-password-reset'),
    resetPasswordPath: z.literal('/api/auth/reset-password'),
    sendVerificationEmailPath: z.literal('/api/auth/send-verification-email'),
    verifyEmailPath: z.literal('/api/auth/verify-email'),
    magicLinkPath: z.literal('/api/auth/sign-in/magic-link'),
    emailOtpPath: z.literal('/api/auth/email-otp/send-verification-otp'),
    emailOtpSignInPath: z.literal('/api/auth/sign-in/email-otp'),
    emailOtpVerificationPath: z.literal('/api/auth/email-otp/verify-email'),
    emailOtpPasswordResetRequestPath: z.literal('/api/auth/email-otp/request-password-reset'),
    emailOtpPasswordResetPath: z.literal('/api/auth/email-otp/reset-password'),
  }),
  oidc: z.object({
    issuer: z.string(),
    discoveryUrl: z.string(),
    authorizationEndpoint: z.string(),
    tokenEndpoint: z.string(),
    jwksUri: z.string(),
    userInfoEndpoint: z.string(),
    endSessionEndpoint: z.string(),
  }),
  security: z.object({
    mfaRequired: z.boolean(),
    sessionExpiresInSeconds: z.number(),
    passkeysEnabled: z.boolean(),
  }),
})

export type ConfigzConfigResponse = z.infer<typeof configzConfigResponseSchema>

function isHostedCustomCss(value: string) {
  if (!value) return true
  if (/[{}<>@]/.test(value)) return false
  if (/(url\s*\(|expression\s*\(|javascript:|import)/i.test(value)) return false

  return value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .every((declaration) => /^--auth-[a-z0-9-]+\s*:\s*[-#.,%()'" a-zA-Z0-9]+$/.test(declaration))
}
