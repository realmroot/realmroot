import { conflict, notFound } from '@server/domain/errors'
import { loadAuthConnectorConfig } from '@server/usecases/connectors'
import type { Deps } from '@server/usecases/deps'
import type { ConfigzAccountCenter, ConfigzBranding } from '@server/usecases/ports'
import { type ConfigzConfigResponse, hostedCustomCssSchema } from '@shared/api/configz'
import type {
  DeveloperConsoleAccessPolicyResponse,
  EmailDeliveryConfigurationResponse,
  ManagementAccountCenterSettingsResponse,
  ManagementBrandingSettingsResponse,
  ManagementRealmResponse,
  ManagementSignInSettingsResponse,
  OrganizationCreationPolicyResponse,
  ReplaceDeveloperConsoleAccessPolicyRequest,
  ReplaceEmailDeliveryConfigurationRequest,
  ReplaceOrganizationCreationPolicyRequest,
  UpdateManagementAccountCenterSettingsRequest,
  UpdateManagementBrandingSettingsRequest,
  UpdateManagementRealmRequest,
  UpdateManagementSignInSettingsRequest,
} from '@shared/api/management'
import type { SecurityPolicy } from '@shared/api/security'

export interface ConfigzOptions {
  issuer: string
  emailOtpEnabled?: boolean
  usernameEnabled?: boolean
  securityPolicy?: SecurityPolicy
  emailDelivery?: {
    bindingAvailable: boolean
    fromEmail?: string
    fromName?: string
  }
}

const defaultCopy = {
  productName: 'Realmroot',
  headline: 'Sign in to Realmroot',
  description: 'Use your account to continue securely.',
}

export const defaultBuiltInProviders: ManagementSignInSettingsResponse['builtInProviders'] = {
  email: {
    enabled: true,
    otpLength: 6,
    expiresInSeconds: 300,
  },
  phone: {
    enabled: false,
    smsProvider: 'twilio',
    otpLength: 6,
    expiresInSeconds: 300,
    signUpOnVerification: false,
    requireVerification: true,
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioFromNumber: '',
    vonageApiKey: '',
    vonageApiSecret: '',
    vonageFrom: '',
    messageBirdAccessKey: '',
    messageBirdOriginator: '',
  },
  web3Wallet: {
    enabled: false,
    chains: [1],
    domain: '',
    emailDomainName: '',
    allowSignUp: true,
    ensLookupEnabled: false,
  },
  passkey: {
    allowSignUp: true,
  },
  oneTap: {
    enabled: false,
    clientId: '',
    autoSelect: false,
    cancelOnTapOutside: true,
    uxMode: 'popup',
    context: 'signin',
    promptBaseDelayMs: 1000,
    promptMaxAttempts: 5,
    disableSignUp: false,
  },
}

export const defaultAccountCenterSettings: ConfigzAccountCenter = {
  profileEditingEnabled: true,
  displayNameEditable: true,
  usernameEditable: true,
  avatarEditable: true,
  emailChangeEnabled: true,
  passwordChangeEnabled: true,
  connectedAccountsEnabled: true,
  sessionsViewEnabled: true,
  dangerZoneEnabled: false,
}

export async function getConfig(deps: Deps, options: ConfigzOptions): Promise<ConfigzConfigResponse> {
  const settings = await deps.configz.getSettings()
  const branding = await deps.configz.getBranding(null)
  const accountCenter = await deps.configz.getAccountCenterSettings()
  const identityProviders = await deps.configz.listEnabledIdentityProviders()
  const availableIdentityProviderIds = new Set((await loadAuthConnectorConfig(deps.connectors)).trustedProviders)
  const copy = readCopy(settings?.metadata)
  const emailOtpEnabled = readBoolean(settings?.metadata, 'emailOtpEnabled') ?? options.emailOtpEnabled ?? true
  const builtInProviders = readBuiltInProviders(settings?.metadata, emailOtpEnabled)
  const passwordEnabled = settings?.passwordEnabled ?? true
  const signupEnabled = settings?.signupEnabled ?? true
  const issuer = options.issuer.replace(/\/$/, '')

  return {
    onboarding: {
      required: !(await deps.onboarding.hasUsers()),
      href: '/onboarding',
    },
    signIn: {
      passwordEnabled,
      signupEnabled,
      socialLoginEnabled: settings?.socialLoginEnabled ?? true,
      emailOtpEnabled: builtInProviders.email.enabled,
      usernameEnabled: readBoolean(settings?.metadata, 'usernameEnabled') ?? options.usernameEnabled ?? true,
      identifierFirst: settings?.identifierFirst ?? false,
    },
    builtInProviders: {
      email: { enabled: builtInProviders.email.enabled },
      phone: { enabled: builtInProviders.phone.enabled },
      web3Wallet: {
        enabled: builtInProviders.web3Wallet.enabled,
        chains: builtInProviders.web3Wallet.chains,
        allowSignUp: builtInProviders.web3Wallet.allowSignUp,
      },
      passkey: { allowSignUp: builtInProviders.passkey.allowSignUp },
      oneTap: {
        enabled: builtInProviders.oneTap.enabled,
        clientId: builtInProviders.oneTap.clientId,
        autoSelect: builtInProviders.oneTap.autoSelect,
        cancelOnTapOutside: builtInProviders.oneTap.cancelOnTapOutside,
        uxMode: builtInProviders.oneTap.uxMode,
        context: builtInProviders.oneTap.context,
        promptBaseDelayMs: builtInProviders.oneTap.promptBaseDelayMs,
        promptMaxAttempts: builtInProviders.oneTap.promptMaxAttempts,
      },
    },
    branding: branding
      ? toPublicBranding(branding)
      : {
          logoUrl: null,
          faviconUrl: null,
          primaryColor: null,
          backgroundColor: null,
          customCss: null,
        },
    identityProviders:
      (settings?.socialLoginEnabled ?? true)
        ? identityProviders
            .filter((provider) => availableIdentityProviderIds.has(provider.providerId))
            .map((provider) => ({
              slug: provider.slug,
              providerType: provider.providerType,
              providerId: provider.providerId,
              displayName: provider.displayName,
              icon: provider.icon,
            }))
        : [],
    links: {
      termsUri: settings?.termsUri ?? null,
      privacyUri: settings?.privacyUri ?? null,
      supportUri: readString(settings?.metadata ?? null, 'supportUri'),
      supportEmail: settings?.supportEmail ?? null,
    },
    copy,
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
      deviceAuthorizationEndpoint: `${issuer}/api/auth/device/code`,
      tokenEndpoint: `${issuer}/api/auth/oauth2/token`,
      jwksUri: `${issuer}/api/auth/jwks`,
      userInfoEndpoint: `${issuer}/api/auth/oauth2/userinfo`,
      endSessionEndpoint: `${issuer}/api/auth/oauth2/end-session`,
    },
    security: {
      mfaRequired: options.securityPolicy?.mfa.mode === 'required',
      sessionExpiresInSeconds: options.securityPolicy?.sessions.expiresInSeconds ?? 0,
      passkeysEnabled: options.securityPolicy?.passkeys.enabled ?? false,
    },
    accountCenter: accountCenter ?? defaultAccountCenterSettings,
    captcha: {
      enabled: options.securityPolicy?.captcha.enabled ?? false,
      provider: options.securityPolicy?.captcha.provider ?? 'turnstile',
      siteKey: options.securityPolicy?.captcha.siteKey ?? '',
    },
  }
}

export async function getManagementSignInSettings(
  deps: Deps,
  options: ConfigzOptions,
): Promise<ManagementSignInSettingsResponse> {
  const config = await getConfig(deps, options)
  const settings = await deps.configz.getSettings()
  return {
    signIn: config.signIn,
    builtInProviders: readBuiltInProviders(settings?.metadata, options.emailOtpEnabled ?? true),
    links: config.links,
    copy: config.copy,
  }
}

export async function updateManagementSignInSettings(
  deps: Deps,
  options: ConfigzOptions,
  input: UpdateManagementSignInSettingsRequest,
): Promise<ManagementSignInSettingsResponse> {
  await deps.configz.updateSettings({
    ...input.signIn,
    builtInProviders: input.builtInProviders,
    termsUri: input.links?.termsUri,
    privacyUri: input.links?.privacyUri,
    supportUri: input.links?.supportUri,
    supportEmail: input.links?.supportEmail,
    copy: input.copy,
  })

  return getManagementSignInSettings(deps, options)
}

export async function getManagementBrandingSettings(
  deps: Deps,
  options: ConfigzOptions,
): Promise<ManagementBrandingSettingsResponse> {
  const config = await getConfig(deps, options)
  return {
    branding: config.branding,
    copy: config.copy,
  }
}

export async function updateManagementBrandingSettings(
  deps: Deps,
  options: ConfigzOptions,
  input: UpdateManagementBrandingSettingsRequest,
): Promise<ManagementBrandingSettingsResponse> {
  await deps.configz.updateBranding({
    ...input.branding,
    copy: input.copy,
  })

  return getManagementBrandingSettings(deps, options)
}

export async function getManagementAccountCenterSettings(
  deps: Deps,
  options: ConfigzOptions,
): Promise<ManagementAccountCenterSettingsResponse> {
  const config = await getConfig(deps, options)
  return {
    accountCenter: config.accountCenter,
  }
}

export async function updateManagementAccountCenterSettings(
  deps: Deps,
  options: ConfigzOptions,
  input: UpdateManagementAccountCenterSettingsRequest,
): Promise<ManagementAccountCenterSettingsResponse> {
  await deps.configz.updateAccountCenterSettings(input.accountCenter)
  return getManagementAccountCenterSettings(deps, options)
}

export function getOrganizationCreationPolicy(deps: Deps): Promise<OrganizationCreationPolicyResponse> {
  return deps.configz.getOrganizationCreationPolicy()
}

export async function replaceOrganizationCreationPolicy(
  deps: Deps,
  input: ReplaceOrganizationCreationPolicyRequest,
): Promise<OrganizationCreationPolicyResponse> {
  if (input.mode === 'approved_users') {
    for (const userId of input.approvedUserIds) await deps.users.getUser(userId)
  }
  await deps.configz.updateOrganizationCreationPolicy(input)
  return getOrganizationCreationPolicy(deps)
}

export function getDeveloperConsoleAccessPolicy(deps: Deps): Promise<DeveloperConsoleAccessPolicyResponse> {
  return deps.configz.getDeveloperConsoleAccessPolicy()
}

export async function replaceDeveloperConsoleAccessPolicy(
  deps: Deps,
  input: ReplaceDeveloperConsoleAccessPolicyRequest,
): Promise<DeveloperConsoleAccessPolicyResponse> {
  for (const organizationId of input.mode === 'selected_organizations' ? input.selectedOrganizationIds : []) {
    if (!(await deps.authorization.findOrganization(organizationId))) {
      throw notFound(`Organization ${organizationId} was not found.`)
    }
  }
  await deps.configz.updateDeveloperConsoleAccessPolicy(input)
  return getDeveloperConsoleAccessPolicy(deps)
}

export async function getManagementRealm(deps: Deps, options: ConfigzOptions): Promise<ManagementRealmResponse> {
  const settings = await deps.configz.getSettings()
  const issuer = options.issuer.replace(/\/$/, '')
  return {
    id: 'realm',
    name: readCopy(settings?.metadata).productName,
    issuer: `${issuer}/api/auth`,
    oidcDiscoveryUrl: `${issuer}/api/auth/.well-known/openid-configuration`,
    jwksUrl: `${issuer}/api/auth/jwks`,
    managementApiUrl: `${issuer}/api/openapi.json`,
  }
}

export async function updateManagementRealm(
  deps: Deps,
  options: ConfigzOptions,
  input: UpdateManagementRealmRequest,
): Promise<ManagementRealmResponse> {
  await deps.configz.updateSettings({ copy: { productName: input.name } })
  return getManagementRealm(deps, options)
}

export async function getEmailDeliveryConfiguration(
  deps: Deps,
  options: ConfigzOptions,
): Promise<EmailDeliveryConfigurationResponse> {
  const stored = await deps.configz.getEmailSettings()
  const fallback = options.emailDelivery
  return {
    provider: 'cloudflare_email',
    enabled: stored?.enabled ?? Boolean(fallback?.bindingAvailable && fallback.fromEmail),
    fromEmail: stored?.fromEmail ?? fallback?.fromEmail ?? null,
    fromName: stored?.fromName ?? fallback?.fromName ?? null,
    replyToEmail: stored?.replyToEmail ?? null,
    bindingAvailable: fallback?.bindingAvailable ?? false,
    source: stored ? 'database' : fallback?.fromEmail ? 'environment' : 'unconfigured',
  }
}

export async function replaceEmailDeliveryConfiguration(
  deps: Deps,
  options: ConfigzOptions,
  input: ReplaceEmailDeliveryConfigurationRequest,
): Promise<EmailDeliveryConfigurationResponse> {
  if (input.enabled && !options.emailDelivery?.bindingAvailable) {
    throw conflict('Cloudflare Email binding is not available for this deployment.')
  }
  await deps.configz.updateEmailSettings(input)
  return getEmailDeliveryConfiguration(deps, options)
}

function toPublicBranding(branding: ConfigzBranding): ConfigzConfigResponse['branding'] {
  return {
    logoUrl: branding.logoUrl ?? branding.logoAssetUrl,
    faviconUrl: branding.faviconUrl ?? branding.faviconAssetUrl,
    primaryColor: safeHexColor(branding.primaryColor),
    backgroundColor: safeHexColor(branding.backgroundColor),
    customCss: safeCustomCss(branding.customCss),
  }
}

function safeHexColor(color: string | null) {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null
}

function safeCustomCss(customCss: string | null) {
  if (customCss === null) return null
  const result = hostedCustomCssSchema.safeParse(customCss)
  return result.success ? result.data : null
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

function readBuiltInProviders(metadata: Record<string, unknown> | null | undefined, emailOtpEnabled = true) {
  const value =
    metadata && typeof metadata.builtInProviders === 'object' && metadata.builtInProviders !== null
      ? (metadata.builtInProviders as Partial<ManagementSignInSettingsResponse['builtInProviders']>)
      : {}

  return {
    email: {
      ...defaultBuiltInProviders.email,
      enabled: emailOtpEnabled,
      ...(value.email ?? {}),
    },
    phone: { ...defaultBuiltInProviders.phone, ...(value.phone ?? {}), signUpOnVerification: false },
    web3Wallet: { ...defaultBuiltInProviders.web3Wallet, ...(value.web3Wallet ?? {}) },
    passkey: { ...defaultBuiltInProviders.passkey, ...(value.passkey ?? {}) },
    oneTap: { ...defaultBuiltInProviders.oneTap, ...(value.oneTap ?? {}), disableSignUp: false },
  }
}

function readString(value: Record<string, unknown> | null, key: string) {
  if (!value || !(key in value)) return null
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field : null
}

function readBoolean(value: Record<string, unknown> | null | undefined, key: string) {
  const field = value?.[key]
  return typeof field === 'boolean' ? field : null
}
