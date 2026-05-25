import { agentAuth } from '@better-auth/agent-auth'
import { i18n } from '@better-auth/i18n'
import { oauthProvider } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, genericOAuth, jwt, oneTap, phoneNumber, siwe, twoFactor } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { organization } from 'better-auth/plugins/organization'
import { username } from 'better-auth/plugins/username'
import { verifyMessage } from 'viem'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import {
  type ApplicationOidcClaims,
  defaultApplicationOidcClaims,
  managementApplicationScopes,
  systemCliClientId,
  userConfigurableApplicationScopes,
} from '../shared/api/applications'
import type { ManagementSignInSettingsResponse } from '../shared/api/management'
import type { SecurityPolicy } from '../shared/api/security'
import { betterAuthTranslations } from './auth-i18n'
import type { Database } from './db/client'
import * as schema from './db/schema'
import type { TransactionalEmailSender } from './lib/email/sender'
import { hashPassword, verifyPassword } from './lib/password'
import { agentCapabilities, areKnownAgentCapabilities } from './modules/agents/capabilities'
import { createDrizzleAgentRepository } from './modules/agents/repository'
import { AgentService } from './modules/agents/service'
import { createDrizzleApplicationRepository } from './modules/applications/drizzle-repository'
import { createDrizzleAuthorizationRepository } from './modules/authorization/drizzle-repository'
import { AuthorizationService, type AuthorizationTokenClaimInput } from './modules/authorization/service'
import type { AuthConnectorConfig } from './modules/connectors/service'
import { createUserRepository } from './modules/users/repository'

const oauthScopes = ['openid', 'profile', 'email', 'offline_access', ...managementApplicationScopes]
const organizationAccessControl = createAccessControl({
  organization: ['create', 'read', 'update', 'delete'],
  member: ['create', 'read', 'update', 'delete'],
  invitation: ['create', 'read', 'cancel'],
  role: ['create', 'read', 'update', 'delete', 'assign'],
  apiResource: ['create', 'read', 'update', 'delete'],
} as const)

const organizationRoles = {
  owner: organizationAccessControl.newRole({
    organization: ['create', 'read', 'update', 'delete'],
    member: ['create', 'read', 'update', 'delete'],
    invitation: ['create', 'read', 'cancel'],
    role: ['create', 'read', 'update', 'delete', 'assign'],
    apiResource: ['create', 'read', 'update', 'delete'],
  }),
  admin: organizationAccessControl.newRole({
    organization: ['read', 'update'],
    member: ['create', 'read', 'update', 'delete'],
    invitation: ['create', 'read', 'cancel'],
    role: ['read', 'assign'],
    apiResource: ['read'],
  }),
  member: organizationAccessControl.newRole({
    organization: ['read'],
    member: ['read'],
    invitation: ['read'],
    role: ['read'],
    apiResource: ['read'],
  }),
}

export function createAuth(
  db: Database,
  secret: string,
  baseURL: string,
  trustedOrigins: string[],
  emailSender: TransactionalEmailSender,
  securityPolicy: SecurityPolicy,
  connectors: AuthConnectorConfig = {
    trustedProviders: [],
    socialProviders: {},
    genericOAuthProviders: [],
    cacheKey: '[]',
  },
  options: {
    builtInProviders?: ManagementSignInSettingsResponse['builtInProviders']
    twoFactorEmailOtpEnabled?: boolean
    validAudiences?: string[]
  } = {},
) {
  const authorization = new AuthorizationService(createDrizzleAuthorizationRepository(db))
  const applications = createDrizzleApplicationRepository(db)
  const agents = new AgentService(createUserRepository(db), createDrizzleAgentRepository(db))

  return betterAuth({
    appName: 'FlareAuth',
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    secret,
    baseURL,
    experimental: {
      joins: true,
    },
    disabledPaths: [
      '/token',
      ...(!securityPolicy.passkeys.enabled
        ? [
            '/passkey/generate-register-options',
            '/passkey/generate-authenticate-options',
            '/passkey/verify-registration',
            '/passkey/verify-authentication',
            '/passkey/list-user-passkeys',
            '/passkey/delete-passkey',
            '/passkey/update-passkey',
          ]
        : []),
    ],
    trustedOrigins,
    socialProviders: connectors.socialProviders,
    account: {
      accountLinking: {
        trustedProviders: connectors.trustedProviders,
      },
    },
    user: {
      additionalFields: {
        username: {
          type: 'string',
          required: false,
          unique: true,
          fieldName: 'username',
        },
        avatarAssetId: {
          type: 'string',
          required: false,
          fieldName: 'avatar_asset_id',
        },
      },
      changeEmail: {
        enabled: true,
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          template: {
            type: 'verification',
            url,
          },
        })
      },
    },
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          template: {
            type: 'password-reset',
            url,
          },
        })
      },
      onPasswordReset: async ({ user }) => {
        sendPasswordChangedNotification(emailSender, user.email)
      },
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    session: {
      expiresIn: securityPolicy.sessions.expiresInSeconds,
      updateAge: securityPolicy.sessions.updateAgeSeconds,
      freshAge: securityPolicy.sessions.freshAgeSeconds,
      cookieCache: {
        enabled: true,
        maxAge: securityPolicy.sessions.cookieCacheSeconds,
      },
    },
    plugins: [
      i18n({
        translations: betterAuthTranslations,
        defaultLocale: 'en',
        detection: ['cookie', 'header'],
        localeCookie: 'flareauth_locale',
      }),
      jwt({
        jwt: {
          issuer: `${baseURL}/api/auth`,
          audience: `${baseURL}/api/auth`,
        },
      }),
      admin(),
      twoFactor({
        issuer: 'FlareAuth',
        allowPasswordless: true,
        twoFactorCookieMaxAge: 60 * 10,
        trustDeviceMaxAge: 60 * 60 * 24 * 30,
        totpOptions: {
          disable: !securityPolicy.mfa.authenticatorAppEnabled,
        },
        ...(options.twoFactorEmailOtpEnabled
          ? {
              otpOptions: {
                sendOTP: async ({ user, otp }) => {
                  await emailSender.send({
                    to: user.email,
                    template: {
                      type: 'otp',
                      otp,
                    },
                  })
                },
              },
            }
          : {}),
      }),
      passkey({
        rpID: securityPolicy.passkeys.rpId,
        rpName: securityPolicy.passkeys.rpName,
        origin: securityPolicy.passkeys.origins,
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
      }),
      agentAuth({
        providerName: 'FlareAuth',
        providerDescription: 'Delegated FlareAuth account access for approved agents.',
        modes: ['delegated'],
        approvalMethods: ['device_authorization'],
        deviceAuthorizationPage: '/agent/approve',
        allowDynamicHostRegistration: true,
        defaultHostCapabilities: [],
        requireAuthForCapabilities: false,
        capabilities: agentCapabilities,
        validateCapabilities: areKnownAgentCapabilities,
        onExecute: ({ capability, arguments: args, agentSession }) =>
          agents.executeReadOnlyCapability({ capability, arguments: args, agentSession }),
      }),
      emailOTP({
        otpLength: options.builtInProviders?.email.otpLength,
        expiresIn: options.builtInProviders?.email.expiresInSeconds,
        changeEmail: {
          enabled: true,
          verifyCurrentEmail: false,
        },
        sendVerificationOTP: async ({ email, otp }) => {
          await emailSender.send({
            to: email,
            template: {
              type: 'otp',
              otp,
            },
          })
        },
      }),
      ...(options.builtInProviders?.phone.enabled
        ? [
            phoneNumber({
              otpLength: options.builtInProviders.phone.otpLength,
              expiresIn: options.builtInProviders.phone.expiresInSeconds,
              requireVerification: options.builtInProviders.phone.requireVerification,
              signUpOnVerification: undefined,
              sendOTP: async ({ phoneNumber, code }) => {
                await sendSmsOtp(options.builtInProviders?.phone, phoneNumber, code)
              },
              sendPasswordResetOTP: async ({ phoneNumber, code }) => {
                await sendSmsOtp(options.builtInProviders?.phone, phoneNumber, code)
              },
            }),
          ]
        : []),
      ...(options.builtInProviders?.oneTap.enabled
        ? [
            oneTap({
              clientId: options.builtInProviders.oneTap.clientId || undefined,
              disableSignup: false,
            }),
          ]
        : []),
      ...(options.builtInProviders?.web3Wallet.enabled
        ? [
            siwe({
              domain: siweDomain(baseURL, options.builtInProviders.web3Wallet.domain),
              emailDomainName: options.builtInProviders.web3Wallet.emailDomainName || 'wallet.local',
              anonymous: true,
              getNonce: async () => createNonce(),
              verifyMessage: async ({ address, chainId, message, signature, cacao }) => {
                if (!options.builtInProviders?.web3Wallet.chains.includes(chainId)) return false
                const parsed = parseSiweMessage(message)
                const valid = validateSiweMessage({
                  address: address as `0x${string}`,
                  domain: siweDomain(baseURL, options.builtInProviders.web3Wallet.domain),
                  message: parsed,
                  nonce: cacao?.p.nonce,
                })
                if (!valid || parsed.chainId !== chainId) return false
                return verifyMessage({
                  address: address as `0x${string}`,
                  message,
                  signature: signature as `0x${string}`,
                })
              },
            }),
          ]
        : []),
      username({
        minUsernameLength: 3,
        maxUsernameLength: 64,
        usernameValidator: (value) => /^[a-zA-Z0-9_.-]+$/.test(value),
      }),
      organization({
        teams: {
          enabled: false,
        },
        dynamicAccessControl: {
          enabled: true,
        },
        ac: organizationAccessControl,
        roles: organizationRoles,
        sendInvitationEmail: async ({ email, id, inviter }) => {
          await emailSender.send({
            to: email,
            template: {
              type: 'invitation',
              inviterName: inviter.user.name,
              url: `${baseURL}/organization/accept-invitation?id=${id}`,
            },
          })
        },
      }),
      genericOAuth({
        config: connectors.genericOAuthProviders,
      }),
      oauthProvider({
        loginPage: '/sign-in',
        consentPage: '/oauth/consent',
        scopes: oauthScopes,
        validAudiences: options.validAudiences,
        customAccessTokenClaims: (input) => buildOAuthAccessTokenClaims(authorization, input),
        customUserInfoClaims: async ({ user, scopes, jwt }) => {
          const clientId = readString(jwt, 'client_id') ?? readString(jwt, 'azp')
          if (clientId !== systemCliClientId) {
            return buildOAuthUserInfoClaims(authorization, applications, { clientId, user, scopes, jwt })
          }
          if (!hasManagementScope(scopes)) return {}
          return {
            role: readUserRole(user),
            scope: jwt.scope,
            client_id: clientId,
            authorization: jwt.authorization,
            roles: jwt.roles,
          }
        },
        customIdTokenClaims: (input) => buildOAuthIdTokenClaims(authorization, input),
        clientRegistrationDefaultScopes: ['openid', 'profile', 'email'],
        clientRegistrationAllowedScopes: [...userConfigurableApplicationScopes],
        storeClientSecret: 'hashed',
        storeTokens: 'hashed',
        silenceWarnings: {
          oauthAuthServerConfig: true,
          openidConfig: true,
        },
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

function siweDomain(baseURL: string, configuredDomain: string) {
  if (configuredDomain.trim()) return configuredDomain.trim()
  return new URL(baseURL).host
}

function createNonce() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sendPasswordChangedNotification(emailSender: TransactionalEmailSender, email: string) {
  void emailSender
    .send({
      to: email,
      template: {
        type: 'security-notification',
        title: 'Your password was changed',
        body: 'Your FlareAuth password was changed. If this was not you, reset your password immediately.',
      },
    })
    .catch((error: unknown) => {
      console.error('Failed to send password changed notification.', error)
    })
}

async function sendSmsOtp(
  config: ManagementSignInSettingsResponse['builtInProviders']['phone'] | undefined,
  phoneNumber: string,
  code: string,
) {
  if (!config) throw new Error('Phone provider is not configured.')

  if (config.smsProvider === 'twilio') {
    if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFromNumber) {
      throw new Error('Twilio SMS provider is not configured.')
    }
    const body = new URLSearchParams({
      To: phoneNumber,
      From: config.twilioFromNumber,
      Body: `Your verification code is ${code}`,
    })
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${config.twilioAccountSid}:${config.twilioAuthToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    )
    if (!response.ok) throw new Error('Twilio SMS delivery failed.')
    return
  }

  if (config.smsProvider === 'vonage') {
    if (!config.vonageApiKey || !config.vonageApiSecret || !config.vonageFrom) {
      throw new Error('Vonage SMS provider is not configured.')
    }
    const body = new URLSearchParams({
      api_key: config.vonageApiKey,
      api_secret: config.vonageApiSecret,
      to: phoneNumber,
      from: config.vonageFrom,
      text: `Your verification code is ${code}`,
    })
    const response = await fetch('https://rest.nexmo.com/sms/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) throw new Error('Vonage SMS delivery failed.')
    const payload = (await response.json()) as { messages?: Array<{ status?: string }> }
    if (payload.messages?.[0]?.status !== '0') throw new Error('Vonage SMS delivery failed.')
    return
  }

  if (config.smsProvider === 'messagebird') {
    if (!config.messageBirdAccessKey || !config.messageBirdOriginator) {
      throw new Error('MessageBird SMS provider is not configured.')
    }
    const body = new URLSearchParams({
      originator: config.messageBirdOriginator,
      recipients: phoneNumber,
      body: `Your verification code is ${code}`,
    })
    const response = await fetch('https://rest.messagebird.com/messages', {
      method: 'POST',
      headers: {
        Authorization: `AccessKey ${config.messageBirdAccessKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!response.ok) throw new Error('MessageBird SMS delivery failed.')
    return
  }

  throw new Error(`Unsupported SMS provider: ${config.smsProvider}`)
}

export async function buildOAuthUserInfoClaims(
  authorization: Pick<AuthorizationService, 'buildTokenClaims'>,
  applications: {
    findByClientId(clientId: string): Promise<{ id: string; oidcClaims: ApplicationOidcClaims } | null>
  },
  input: {
    clientId?: string
    user: unknown
    scopes: Iterable<string>
    jwt: Record<string, unknown>
  },
): Promise<Record<string, unknown>> {
  if (!input.clientId) return {}
  const application = await applications.findByClientId(input.clientId)
  if (!application) return {}
  return authorization.buildTokenClaims({
    userId: readUserId(input.user),
    applicationId: application.id,
    organizationId:
      readAuthorizationString(input.jwt, 'organization_id') ?? readJwtString(input.jwt, 'organization_id'),
    resource: readString(input.jwt, 'aud'),
    scopes: [...input.scopes],
    destination: 'userinfo',
    claimSelection: application.oidcClaims.userInfo,
  })
}

export async function buildOAuthAccessTokenClaims(
  authorization: Pick<AuthorizationService, 'buildTokenClaims'>,
  input: {
    user?: ({ id?: string } & Record<string, unknown>) | null
    scopes: Iterable<string>
    resource?: string
    referenceId?: string
    metadata?: Record<string, unknown>
  },
): Promise<Record<string, unknown>> {
  const oidcClaims = readOidcClaims(input.metadata)
  const claims = await authorization.buildTokenClaims({
    userId: input.user?.id,
    applicationId: readString(input.metadata, 'applicationId'),
    organizationId: input.referenceId,
    resource: input.resource,
    scopes: [...input.scopes],
    destination: 'access_token',
    claimSelection: oidcClaims.accessToken,
  } satisfies AuthorizationTokenClaimInput)
  return claims
}

export async function buildOAuthIdTokenClaims(
  authorization: Pick<AuthorizationService, 'buildTokenClaims'>,
  input: {
    user?: ({ id?: string } & Record<string, unknown>) | null
    scopes?: Iterable<string>
    metadata?: Record<string, unknown>
  },
): Promise<Record<string, unknown>> {
  const applicationId = readString(input.metadata, 'applicationId')
  const oidcClaims = readOidcClaims(input.metadata)
  return {
    ...(applicationId ? { application_id: applicationId } : {}),
    ...(await authorization.buildTokenClaims({
      userId: input.user?.id,
      applicationId,
      scopes: input.scopes ? [...input.scopes] : [],
      destination: 'id_token',
      claimSelection: oidcClaims.idToken,
    })),
  }
}

function readOidcClaims(metadata: Record<string, unknown> | undefined): ApplicationOidcClaims {
  const value = metadata?.oidcClaims
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaultApplicationOidcClaims
  return {
    accessToken: readClaimSelection((value as Record<string, unknown>).accessToken),
    idToken: readClaimSelection((value as Record<string, unknown>).idToken),
    userInfo: readClaimSelection((value as Record<string, unknown>).userInfo),
  }
}

function readClaimSelection(value: unknown): ApplicationOidcClaims['accessToken'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  return {
    ...(input.authorization === true ? { authorization: true } : {}),
    ...(input.scopes === true ? { scopes: true } : {}),
    ...(input.roles === true ? { roles: true } : {}),
    ...(input.permissions === true ? { permissions: true } : {}),
    ...(input.organizationId === true ? { organizationId: true } : {}),
    ...(input.organizationName === true ? { organizationName: true } : {}),
  }
}

function readAuthorizationString(jwt: Record<string, unknown>, key: string) {
  const authorization = jwt.authorization
  if (typeof authorization !== 'object' || authorization === null || !(key in authorization)) return undefined
  const value = (authorization as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function readJwtString(jwt: Record<string, unknown>, key: string) {
  const value = jwt[key]
  return typeof value === 'string' ? value : undefined
}

function readString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : undefined
}

function readUserId(user: unknown) {
  return typeof user === 'object' && user !== null && 'id' in user && typeof user.id === 'string' ? user.id : undefined
}

function hasManagementScope(scopes: Iterable<string>) {
  for (const scope of scopes) {
    if (managementApplicationScopes.includes(scope as (typeof managementApplicationScopes)[number])) return true
  }
  return false
}

function readUserRole(user: unknown) {
  return typeof user === 'object' && user !== null && 'role' in user && typeof user.role === 'string' ? user.role : null
}
