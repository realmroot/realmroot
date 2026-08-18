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
import { createExternalResourceRepository } from '@server/adapters/repos/external-resources'
import type { AuthConnectorConfig } from '@server/usecases/connectors'
import type { Deps } from '@server/usecases/deps'
import { mayCreateOrganization } from '@server/usecases/developer-access'
import type { IdentifierGenerator } from '@server/usecases/identifier-generator'
import { organizationUserHasScope } from '@server/usecases/organization-membership-scopes'
import type { ApplicationRepository } from '@server/usecases/ports'
import { findPlatformOrganization } from '@server/usecases/system-resources'
import { APIError, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { deviceAuthorization, genericOAuth, jwt, oneTap, phoneNumber, siwe, twoFactor } from 'better-auth/plugins'
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
  createNonce,
  filterOAuthAccessTokenScopes,
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
  filterOAuthAccessTokenScopes,
} from './auth-helpers'

import { createUserRepository } from '@server/adapters/repos/users'
import type { WebhookEvent } from '@shared/api/webhooks'
import { organizationAccessControl, organizationRoles } from '@shared/organization-access'

const oauthScopes = ['openid', 'profile', 'email', 'offline_access']

export function createAuth(
  db: Database,
  ids: IdentifierGenerator,
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
    emailDeliveryReady?: boolean
    twoFactorEmailOtpEnabled?: boolean
    validAudiences?: string[]
    externalHttp?: Deps['externalHttp']
    publishWebhookEvent?: (event: WebhookEvent, data: Record<string, unknown>) => Promise<void>
  } = {},
) {
  const applications = createDrizzleApplicationRepository(db, ids)
  const configz = createDrizzleConfigzRepository(db)
  const externalResources = createExternalResourceRepository(db)
  // The better-auth boundary builds its own repos; only the slices the token-claim
  // and agent-capability usecases read are populated here.
  const deps = {
    ids,
    authorization: createDrizzleAuthorizationRepository(db, ids),
    applications,
    users: createUserRepository(db, ids),
    agents: createDrizzleAgentRepository(db),
    agentTokens: createDrizzleAgentTokenRepository(db),
    externalHttp: options.externalHttp,
  } as unknown as Deps

  const auth = betterAuth({
    appName: 'Realmroot',
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    advanced: {
      database: {
        generateId: () => ids.generate(),
      },
    },
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
    databaseHooks: {
      user: options.publishWebhookEvent
        ? {
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
          }
        : undefined,
      session: options.publishWebhookEvent
        ? {
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
          }
        : undefined,
      account: {
        create: {
          before: async (account) => {
            if (account.providerId === 'credential') return { data: account }
            const existing = await externalResources.findActiveUserProviderConnectionByProviderSubject({
              providerId: account.providerId,
              externalSubject: account.accountId,
            })
            if (existing && existing.ownerUserId !== account.userId) {
              throw new APIError('CONFLICT', {
                message: 'This Provider account is already connected to another Realmroot account.',
              })
            }
            return { data: account }
          },
        },
      },
    },
    trustedOrigins,
    socialProviders: connectors.socialProviders,
    account: {
      accountLinking: {
        trustedProviders: connectors.trustedProviders,
        allowDifferentEmails: true,
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
      sendOnSignUp: options.emailDeliveryReady ?? false,
      sendOnSignIn: options.emailDeliveryReady ?? false,
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
      requireEmailVerification: options.emailDeliveryReady ?? false,
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
        deviceAuthorizationPage: '/agent/enrollment',
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
        verificationUri: '/auth/device',
        schema: {},
        ...createDeviceAuthorizationOptions(applications),
      }),
      emailOTP({
        ...(options.builtInProviders?.email.otpLength === undefined
          ? {}
          : { otpLength: options.builtInProviders.email.otpLength }),
        ...(options.builtInProviders?.email.expiresInSeconds === undefined
          ? {}
          : { expiresIn: options.builtInProviders.email.expiresInSeconds }),
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
        allowUserToCreateOrganization: async (user) => {
          const platform = await findPlatformOrganization(deps)
          return mayCreateOrganization(
            await configz.getOrganizationCreationPolicy(),
            { id: user.id, emailVerified: user.emailVerified },
            platform ? await organizationUserHasScope(deps, platform.id, user.id, 'organizations:write') : false,
          )
        },
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
        consentPage: '/auth/consent',
        scopes: oauthScopes,
        validAudiences: options.validAudiences,
        postLogin: {
          page: '/auth/consent',
          consentReferenceId: async ({ session }) =>
            typeof session.activeOrganizationId === 'string' ? session.activeOrganizationId : undefined,
          shouldRedirect: async ({ headers, user, scopes }) => {
            const clientId = headers.get('x-realmroot-oauth-client-id')
            if (!clientId) throw new Error('OAuth consent context is missing the client ID.')
            const application = await applications.findByClientId(clientId)
            if (!application) throw new Error('OAuth consent context does not reference an Application.')
            if (!application.consentRequired) return false

            const resourceUrl = headers.get('x-realmroot-oauth-resource')
            const resource = resourceUrl ? await deps.authorization.findResourceByResourceUrl(resourceUrl) : null
            const consent = await applications.findConsent(application.id, user.id, resource?.id ?? null)
            return !consent || scopes.some((scope) => !consent.scopes.includes(scope))
          },
        },
        filterAccessTokenScopes: (input) => filterOAuthAccessTokenScopes(deps, input),
        customAccessTokenClaims: (input) => buildOAuthAccessTokenClaims(deps, input),
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
  return {
    ...auth,
    handler: async (request: Request) => {
      const normalizedRequest = await normalizeDeviceAuthorizationRequest(request)
      const response = await auth.handler(await withOAuthConsentContext(normalizedRequest))
      return translateNonInteractiveConsentError(normalizedRequest, response)
    },
  }
}

export async function normalizeDeviceAuthorizationRequest(request: Request) {
  const url = new URL(request.url)
  if (request.method !== 'POST' || !url.pathname.endsWith('/device/code')) return request

  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/x-www-form-urlencoded') return request

  const parameters = await request.clone().formData()
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  headers.delete('content-length')
  return new Request(request, {
    headers,
    body: JSON.stringify(Object.fromEntries(parameters.entries())),
  })
}

async function withOAuthConsentContext(request: Request) {
  const url = new URL(request.url)
  const params = await oauthAuthorizationParams(request, url)
  if (!params) return request

  const headers = new Headers(request.headers)
  const clientId = params.get('client_id')
  const resource = params.get('resource')
  if (clientId) headers.set('x-realmroot-oauth-client-id', clientId)
  else headers.delete('x-realmroot-oauth-client-id')
  if (resource) headers.set('x-realmroot-oauth-resource', resource)
  else headers.delete('x-realmroot-oauth-resource')
  return new Request(request, { headers })
}

async function oauthAuthorizationParams(request: Request, url: URL) {
  if (request.method === 'GET' && url.pathname.endsWith('/oauth2/authorize')) return url.searchParams
  if (request.method !== 'POST' || !url.pathname.endsWith('/oauth2/consent')) return null
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return null

  let body: unknown
  try {
    body = await request.clone().json()
  } catch {
    return null
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const oauthQuery = (body as Record<string, unknown>).oauth_query
  return typeof oauthQuery === 'string' ? new URLSearchParams(oauthQuery) : null
}

function translateNonInteractiveConsentError(request: Request, response: Response) {
  const requestUrl = new URL(request.url)
  if (!new Set((requestUrl.searchParams.get('prompt') ?? '').split(/\s+/)).has('none')) return response

  const location = response.headers.get('location')
  if (!location) return response
  const redirect = new URL(location, request.url)
  if (redirect.searchParams.get('error') !== 'interaction_required') return response

  redirect.searchParams.set('error', 'consent_required')
  redirect.searchParams.set('error_description', 'End-User consent is required')
  const headers = new Headers(response.headers)
  headers.set('location', redirect.toString())
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
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
