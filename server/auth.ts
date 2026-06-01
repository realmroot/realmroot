import { agentAuth } from '@better-auth/agent-auth'
import { i18n } from '@better-auth/i18n'
import { oauthProvider } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import { APIError, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  admin,
  deviceAuthorization,
  genericOAuth,
  jwt,
  oneTap,
  phoneNumber,
  siwe,
  twoFactor,
} from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { organization } from 'better-auth/plugins/organization'
import { username } from 'better-auth/plugins/username'
import { verifyMessage } from 'viem'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import {
  deviceCodeGrantType,
  managementApplicationScopes,
  systemCliClientId,
  userConfigurableApplicationScopes,
} from '../shared/api/applications'
import type { ManagementSignInSettingsResponse } from '../shared/api/management'
import type { SecurityPolicy } from '../shared/api/security'
import {
  buildOAuthAccessTokenClaims,
  buildOAuthIdTokenClaims,
  buildOAuthUserInfoClaims,
  createNonce,
  hasManagementScope,
  readString,
  readUserRole,
  sendPasswordChangedNotification,
  sendSmsOtp,
  siweDomain,
} from './auth-helpers'
import { betterAuthTranslations } from './auth-i18n'
import type { Database } from './db/client'
import * as schema from './db/schema'
import type { TransactionalEmailSender } from './lib/email/sender'
import { hashPassword, verifyPassword } from './lib/password'
import { agentCapabilities, areKnownAgentCapabilities } from './modules/agents/capabilities'
import { createDrizzleAgentRepository } from './modules/agents/repository'
import { AgentService } from './modules/agents/service'
import { createDrizzleApplicationRepository } from './modules/applications/drizzle-repository'
import type { ApplicationRepository } from './modules/applications/service'
import { createDrizzleAuthorizationRepository } from './modules/authorization/drizzle-repository'
import { AuthorizationService } from './modules/authorization/service'
import type { AuthConnectorConfig } from './modules/connectors/service'

export { buildOAuthAccessTokenClaims, buildOAuthIdTokenClaims, buildOAuthUserInfoClaims } from './auth-helpers'

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
      deviceAuthorization({
        verificationUri: '/device',
        schema: {},
        ...createDeviceAuthorizationOptions(applications),
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
        loginPage: '/auth/sign-in',
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

export function createDeviceAuthorizationOptions(applications: Pick<ApplicationRepository, 'findByClientId'>) {
  return {
    validateClient: async (clientId: string) => {
      const application = await applications.findByClientId(clientId)
      return (
        !!application &&
        !application.disabled &&
        application.public &&
        application.clientType === 'public_native' &&
        application.allowedGrantTypes.includes(deviceCodeGrantType)
      )
    },
    onDeviceAuthRequest: async (clientId: string, scope: string | undefined) => {
      const application = await applications.findByClientId(clientId)
      if (
        !application ||
        application.disabled ||
        !application.public ||
        application.clientType !== 'public_native' ||
        !application.allowedGrantTypes.includes(deviceCodeGrantType)
      ) {
        throw new APIError('BAD_REQUEST', {
          error: 'invalid_client',
          error_description: 'Invalid client ID',
        })
      }

      const requestedScopes = (scope || 'openid').split(/\s+/).filter(Boolean)
      for (const requestedScope of requestedScopes) {
        if (!application.allowedScopes.includes(requestedScope as (typeof application.allowedScopes)[number])) {
          throw new APIError('BAD_REQUEST', {
            error: 'invalid_request',
            error_description: `Scope is not allowed for this client: ${requestedScope}`,
          })
        }
      }
    },
  }
}
