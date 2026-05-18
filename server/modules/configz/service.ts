import type { ConfigzConfigResponse } from '../../../shared/api/configz'
import type { SecurityPolicy } from '../../../shared/api/security'
import type { OnboardingRepository } from '../onboarding/repository'

export interface ConfigzSettings {
  defaultApplicationId: string | null
  passwordEnabled: boolean
  signupEnabled: boolean
  socialLoginEnabled: boolean
  identifierFirst: boolean
  defaultRedirectUri: string | null
  termsUri: string | null
  privacyUri: string | null
  supportEmail: string | null
  metadata: Record<string, unknown> | null
}

export interface ConfigzBranding {
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string | null
  backgroundColor: string | null
  customCss: string | null
}

export interface ConfigzIdentityProvider {
  slug: string
  providerType: string
  providerId: string
  displayName: string
}

export interface ConfigzApplication {
  id: string
  clientId: string
  redirectUris: string[]
  disabled: boolean
}

export interface ConfigzRepository {
  getSettings(): Promise<ConfigzSettings | null>
  getBranding(applicationId: string | null): Promise<ConfigzBranding | null>
  listEnabledIdentityProviders(): Promise<ConfigzIdentityProvider[]>
}

export interface ConfigzServiceOptions {
  issuer: string
  magicLinkEnabled: boolean
  emailOtpEnabled: boolean
  usernameEnabled: boolean
  onboardingRepository?: OnboardingRepository
  securityPolicy?: SecurityPolicy
}

const defaultCopy = {
  productName: 'FlareAuth',
  headline: 'Sign in to FlareAuth',
  description: 'Use your account to continue securely.',
}

export class ConfigzService {
  constructor(
    private readonly repository: ConfigzRepository,
    private readonly options: ConfigzServiceOptions,
  ) {}

  async getConfig(): Promise<ConfigzConfigResponse> {
    const settings = await this.repository.getSettings()
    const branding = await this.repository.getBranding(settings?.defaultApplicationId ?? null)
    const identityProviders = await this.repository.listEnabledIdentityProviders()
    const copy = readCopy(settings?.metadata)
    const passwordEnabled = settings?.passwordEnabled ?? true
    const signupEnabled = settings?.signupEnabled ?? true
    const issuer = this.options.issuer.replace(/\/$/, '')

    return {
      onboarding: {
        required: this.options.onboardingRepository ? !(await this.options.onboardingRepository.hasUsers()) : false,
        href: '/onboarding',
      },
      signIn: {
        passwordEnabled,
        signupEnabled,
        socialLoginEnabled: settings?.socialLoginEnabled ?? true,
        magicLinkEnabled: this.options.magicLinkEnabled && signupEnabled,
        emailOtpEnabled: this.options.emailOtpEnabled && signupEnabled,
        usernameEnabled: this.options.usernameEnabled,
        identifierFirst: settings?.identifierFirst ?? false,
      },
      branding: branding ?? {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: null,
        backgroundColor: null,
        customCss: null,
      },
      identityProviders:
        (settings?.socialLoginEnabled ?? true)
          ? identityProviders.map((provider) => ({
              slug: provider.slug,
              providerType: provider.providerType,
              providerId: provider.providerId,
              displayName: provider.displayName,
            }))
          : [],
      links: {
        termsUri: settings?.termsUri ?? null,
        privacyUri: settings?.privacyUri ?? null,
        supportEmail: settings?.supportEmail ?? null,
      },
      copy,
      defaults: {
        applicationId: settings?.defaultApplicationId ?? null,
        redirectUri: settings?.defaultRedirectUri ?? null,
      },
      auth: {
        basePath: '/api/auth',
        signInEmailPath: '/api/auth/sign-in/email',
        signInUsernamePath: '/api/auth/sign-in/username',
        signUpEmailPath: '/api/auth/sign-up/email',
        signOutPath: '/api/auth/sign-out',
        requestPasswordResetPath: '/api/auth/request-password-reset',
        resetPasswordPath: '/api/auth/reset-password',
        sendVerificationEmailPath: '/api/auth/send-verification-email',
        verifyEmailPath: '/api/auth/verify-email',
        magicLinkPath: '/api/auth/sign-in/magic-link',
        emailOtpPath: '/api/auth/email-otp/send-verification-otp',
        emailOtpSignInPath: '/api/auth/sign-in/email-otp',
        emailOtpVerificationPath: '/api/auth/email-otp/verify-email',
        emailOtpPasswordResetRequestPath: '/api/auth/email-otp/request-password-reset',
        emailOtpPasswordResetPath: '/api/auth/email-otp/reset-password',
      },
      oidc: {
        issuer: `${issuer}/api/auth`,
        discoveryUrl: `${issuer}/api/auth/.well-known/openid-configuration`,
        authorizationEndpoint: `${issuer}/api/auth/oauth2/authorize`,
        tokenEndpoint: `${issuer}/api/auth/oauth2/token`,
        jwksUri: `${issuer}/api/auth/jwks`,
        userInfoEndpoint: `${issuer}/api/auth/userinfo`,
        endSessionEndpoint: `${issuer}/api/auth/oauth2/logout`,
      },
      security: {
        mfaRequired: this.options.securityPolicy?.mfa.mode === 'required',
        sessionExpiresInSeconds: this.options.securityPolicy?.sessions.expiresInSeconds ?? 0,
        passkeysEnabled: this.options.securityPolicy?.passkeys.enabled ?? false,
      },
    }
  }
}

function readCopy(metadata: Record<string, unknown> | null | undefined) {
  const copy =
    metadata && typeof metadata.copy === 'object' && metadata.copy !== null
      ? (metadata.copy as Record<string, unknown>)
      : null

  return {
    productName: readString(copy, 'productName') ?? defaultCopy.productName,
    headline: readString(copy, 'headline') ?? defaultCopy.headline,
    description: readString(copy, 'description') ?? defaultCopy.description,
  }
}

function readString(value: Record<string, unknown> | null, key: string) {
  if (!value || !(key in value)) return null
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field : null
}
