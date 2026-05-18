import type {
  ExperienceCallbackQuery,
  ExperienceCallbackResponse,
  ExperienceConfigResponse,
} from '../../../shared/api/experience'
import { badRequest, notFound } from '../../lib/errors'

export interface ExperienceSettings {
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

export interface ExperienceBranding {
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string | null
  backgroundColor: string | null
  customCss: string | null
}

export interface ExperienceIdentityProvider {
  slug: string
  providerType: string
  providerId: string
  displayName: string
}

export interface ExperienceApplication {
  id: string
  clientId: string
  redirectUris: string[]
  disabled: boolean
}

export interface ExperienceRepository {
  getSettings(): Promise<ExperienceSettings | null>
  getBranding(applicationId: string | null): Promise<ExperienceBranding | null>
  listEnabledIdentityProviders(): Promise<ExperienceIdentityProvider[]>
  findApplicationByClientId(clientId: string): Promise<ExperienceApplication | null>
}

export interface ExperienceServiceOptions {
  issuer: string
  magicLinkEnabled: boolean
  emailOtpEnabled: boolean
  usernameEnabled: boolean
}

const defaultCopy = {
  productName: 'FlareAuth',
  headline: 'Sign in to FlareAuth',
  description: 'Use your account to continue securely.',
}

export class ExperienceService {
  constructor(
    private readonly repository: ExperienceRepository,
    private readonly options: ExperienceServiceOptions,
  ) {}

  async getConfig(): Promise<ExperienceConfigResponse> {
    const settings = await this.repository.getSettings()
    const branding = await this.repository.getBranding(settings?.defaultApplicationId ?? null)
    const identityProviders = await this.repository.listEnabledIdentityProviders()
    const copy = readCopy(settings?.metadata)
    const passwordEnabled = settings?.passwordEnabled ?? true
    const signupEnabled = settings?.signupEnabled ?? true

    return {
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
              displayName: provider.displayName,
              authorizationUrl: `${this.options.issuer}/api/auth/sign-in/social?provider=${encodeURIComponent(
                provider.providerId,
              )}`,
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
    }
  }

  async getCallbackState(query: ExperienceCallbackQuery): Promise<ExperienceCallbackResponse> {
    const returnTo = query.return_to ?? query.redirect_uri ?? null

    if (query.error) {
      return {
        state: query.state ?? null,
        returnTo,
        error: {
          code: query.error,
          description: query.error_description ?? null,
        },
        consent: null,
      }
    }

    if (!query.client_id && !query.redirect_uri) {
      return {
        state: query.state ?? null,
        returnTo,
        error: null,
        consent: null,
      }
    }

    if (!query.client_id || !query.redirect_uri) {
      throw badRequest('client_id and redirect_uri are both required for OAuth callback state.')
    }

    const application = await this.repository.findApplicationByClientId(query.client_id)
    if (!application || application.disabled) {
      throw notFound('OAuth client was not found.')
    }
    if (!application.redirectUris.includes(query.redirect_uri)) {
      throw badRequest('redirect_uri is not registered for this client.')
    }

    const params = new URLSearchParams({
      client_id: query.client_id,
      redirect_uri: query.redirect_uri,
    })
    if (query.state) params.set('state', query.state)

    return {
      state: query.state ?? null,
      returnTo,
      error: null,
      consent: {
        clientId: query.client_id,
        redirectUri: query.redirect_uri,
        href: `/oauth/consent?${params.toString()}`,
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
