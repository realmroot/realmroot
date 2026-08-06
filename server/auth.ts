import { agentAuth } from '@better-auth/agent-auth'
import { i18n } from '@better-auth/i18n'
import { oauthProvider } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import type { TransactionalEmailSender } from '@server/adapters/gateways/email/sender'
import { createDrizzleAgentTokenRepository } from '@server/adapters/repos/agent-tokens'
import { createDrizzleAgentRepository } from '@server/adapters/repos/agents'
import { createDrizzleApplicationRepository } from '@server/adapters/repos/applications'
import { createDrizzleAuthorizationRepository } from '@server/adapters/repos/authorization'
import { createDrizzleConfigzRepository } from '@server/adapters/repos/configz'
import type { AuthConnectorConfig } from '@server/usecases/connectors'
import type { Deps } from '@server/usecases/deps'
import { mayCreateOrganization } from '@server/usecases/developer-access'
import type { ApplicationRepository } from '@server/usecases/ports'
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
import { emailOTP } from 'better-auth/plugins/email-otp'
import { organization } from 'better-auth/plugins/organization'
import { username } from 'better-auth/plugins/username'
import { verifyMessage } from 'viem'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { deviceCodeGrantType, userConfigurableApplicationScopes } from '../shared/api/applications'
import type { ManagementSignInSettingsResponse } from '../shared/api/management'
import type { SecurityPolicy } from '../shared/api/security'
import {
  buildOAuthAccessTokenClaims,
  buildOAuthIdTokenClaims,
  buildOAuthUserInfoClaims,
  createNonce,
  filterOAuthAccessTokenScopes,
  readString,
  sendPasswordChangedNotification,
  sendSmsOtp,
  siweDomain,
} from './auth-helpers'
import { betterAuthTranslations } from './auth-i18n'
import type { Database } from './db/client'
import * as schema from './db/schema'
import { hashPassword, verifyPassword } from './domain/password'

export {
  buildOAuthAccessTokenClaims,
  buildOAuthIdTokenClaims,
  buildOAuthUserInfoClaims,
  filterOAuthAccessTokenScopes,
} from './auth-helpers'

import { createUserRepository } from '@server/adapters/repos/users'
import type { WebhookEvent } from '@shared/api/webhooks'
import { organizationAccessControl, organizationRoles } from '@shared/organization-access'

const oauthScopes = ['openid', 'profile', 'email', 'offline_access']

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
    externalHttp?: Deps['externalHttp']
    publishWebhookEvent?: (event: WebhookEvent, data: Record<string, unknown>) => Promise<void>
  } = {},
) {
  const applications = createDrizzleApplicationRepository(db)
  const configz = createDrizzleConfigzRepository(db)
  // The better-auth boundary builds its own repos; only the slices the token-claim
  // and agent-capability usecases read are populated here.
  const deps = {
    authorization: createDrizzleAuthorizationRepository(db),
    applications,
    users: createUserRepository(db),
    agents: createDrizzleAgentRepository(db),
    agentTokens: createDrizzleAgentTokenRepository(db),
    externalHttp: options.externalHttp,
  } as unknown as Deps

  return betterAuth({
    appName: 'Realmroot',
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
    databaseHooks: options.publishWebhookEvent
      ? {
          user: {
            create: {
              after: async (user) =>
                options.publishWebhookEvent?.('user.created', {
                  user: webhookRecord(user, [
                    'id',
                    'email',
                    'emailVerified',
                    'name',
                    'username',
                    'role',
                    'createdAt',
                    'updatedAt',
                  ]),
                }),
            },
            update: {
              after: async (user) =>
                options.publishWebhookEvent?.('user.updated', {
                  user: webhookRecord(user, [
                    'id',
                    'email',
                    'emailVerified',
                    'name',
                    'username',
                    'role',
                    'createdAt',
                    'updatedAt',
                  ]),
                }),
            },
            delete: {
              after: async (user) =>
                options.publishWebhookEvent?.('user.deleted', {
                  user: webhookRecord(user, ['id', 'email', 'name', 'username', 'role', 'createdAt', 'updatedAt']),
                }),
            },
          },
          session: {
            create: {
              after: async (session) =>
                options.publishWebhookEvent?.('session.created', {
                  session: webhookRecord(session, [
                    'id',
                    'userId',
                    'expiresAt',
                    'ipAddress',
                    'userAgent',
                    'createdAt',
                    'updatedAt',
                  ]),
                }),
            },
            delete: {
              after: async (session) =>
                options.publishWebhookEvent?.('session.revoked', {
                  session: webhookRecord(session, [
                    'id',
                    'userId',
                    'expiresAt',
                    'ipAddress',
                    'userAgent',
                    'createdAt',
                    'updatedAt',
                  ]),
                }),
            },
          },
        }
      : undefined,
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
        localeCookie: 'realmroot_locale',
      }),
      jwt({
        jwt: {
          issuer: `${baseURL}/api/auth`,
          audience: `${baseURL}/api/auth`,
        },
        jwks: {
          keyPairConfig: { alg: 'RS256', modulusLength: 2048 },
          gracePeriod: 60 * 60 * 24 * 30,
        },
      }),
      admin(),
      twoFactor({
        issuer: 'Realmroot',
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
        providerName: 'Realmroot',
        providerDescription: 'Delegated Realmroot account access for approved agents.',
        modes: ['delegated'],
        approvalMethods: ['device_authorization'],
        deviceAuthorizationPage: '/agent/approve',
        allowDynamicHostRegistration: true,
        defaultHostCapabilities: [],
        requireAuthForCapabilities: false,
        capabilities: [],
        validateCapabilities: (capabilities) => capabilities.length === 0,
        consumeJti: async (jti, maxAgeSec) => {
          const now = new Date()
          return deps.agentTokens.consumeAgentAuthJti({
            jtiHash: await sha256Base64Url(jti),
            createdAt: now,
            expiresAt: new Date(now.getTime() + maxAgeSec * 1000),
          })
        },
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
        allowUserToCreateOrganization: async (user) =>
          mayCreateOrganization(await configz.getOrganizationCreationPolicy(), {
            id: user.id,
            emailVerified: user.emailVerified,
            role: typeof user.role === 'string' ? user.role : null,
          }),
        teams: {
          enabled: false,
        },
        ac: organizationAccessControl,
        roles: organizationRoles,
        dynamicAccessControl: { enabled: true },
        sendInvitationEmail: async ({ email, id, inviter }) => {
          await emailSender.send({
            to: email,
            template: {
              type: 'invitation',
              inviterName: inviter.user.name,
              url: `${baseURL}/account/organizations?invitation=${encodeURIComponent(id)}`,
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
        postLogin: {
          page: '/oauth/consent',
          shouldRedirect: async () => false,
          consentReferenceId: async ({ session }) => readString(session, 'activeOrganizationId'),
        },
        filterAccessTokenScopes: (input) => filterOAuthAccessTokenScopes(deps, input),
        customAccessTokenClaims: (input) => buildOAuthAccessTokenClaims(deps, input),
        customUserInfoClaims: async ({ user, scopes, jwt }) => {
          const clientId = readString(jwt, 'client_id') ?? readString(jwt, 'azp')
          return buildOAuthUserInfoClaims(deps, applications, { clientId, user, scopes, jwt })
        },
        customIdTokenClaims: (input) => buildOAuthIdTokenClaims(deps, input),
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

function webhookRecord(record: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(
    fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]]),
  )
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
        const protocolScopes = [
          ...application.oidcScopes,
          ...application.resourceScopes.flatMap((resource) => resource.scopes),
        ]
        if (!protocolScopes.includes(requestedScope)) {
          throw new APIError('BAD_REQUEST', {
            error: 'invalid_request',
            error_description: `Scope is not allowed for this client: ${requestedScope}`,
          })
        }
      }
    },
  }
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
