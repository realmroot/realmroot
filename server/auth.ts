import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, jwt } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { magicLink } from 'better-auth/plugins/magic-link'
import { organization } from 'better-auth/plugins/organization'
import { username } from 'better-auth/plugins/username'
import type { Database } from './db/client'
import * as schema from './db/schema'
import type { TransactionalEmailSender } from './lib/email/sender'
import { hashPassword, verifyPassword } from './lib/password'
import { createDrizzleAuthorizationRepository } from './modules/authorization/drizzle-repository'
import { AuthorizationService } from './modules/authorization/service'

const oauthScopes = ['openid', 'profile', 'email', 'offline_access']
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
) {
  const authorization = new AuthorizationService(createDrizzleAuthorizationRepository(db))

  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    secret,
    baseURL,
    disabledPaths: ['/token'],
    trustedOrigins,
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
        await emailSender.send({
          to: user.email,
          template: {
            type: 'security-notification',
            title: 'Your password was changed',
            body: 'Your FlareAuth password was changed. If this was not you, reset your password immediately.',
          },
        })
      },
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    plugins: [
      jwt({
        jwt: {
          issuer: `${baseURL}/api/auth`,
          audience: `${baseURL}/api/auth`,
        },
      }),
      admin(),
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await emailSender.send({
            to: email,
            template: {
              type: 'magic-link',
              url,
            },
          })
        },
      }),
      emailOTP({
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
      oauthProvider({
        loginPage: '/sign-in',
        consentPage: '/oauth/consent',
        scopes: oauthScopes,
        customAccessTokenClaims: ({ user, scopes, resource, referenceId, metadata }) =>
          authorization.buildTokenClaims({
            userId: user?.id,
            applicationId: readString(metadata, 'applicationId'),
            organizationId: referenceId,
            resource,
            scopes: [...scopes],
          }),
        customIdTokenClaims: ({ metadata }) => ({
          ...(readString(metadata, 'applicationId') ? { application_id: readString(metadata, 'applicationId') } : {}),
        }),
        clientRegistrationDefaultScopes: ['openid', 'profile', 'email'],
        clientRegistrationAllowedScopes: oauthScopes,
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

function readString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : undefined
}
