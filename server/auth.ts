import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, jwt } from 'better-auth/plugins'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { magicLink } from 'better-auth/plugins/magic-link'
import { organization } from 'better-auth/plugins/organization'
import type { Database } from './db/client'
import * as schema from './db/schema'
import type { TransactionalEmailSender } from './lib/email/sender'
import { hashPassword, verifyPassword } from './lib/password'

const oauthScopes = ['openid', 'profile', 'email', 'offline_access']

export function createAuth(
  db: Database,
  secret: string,
  baseURL: string,
  trustedOrigins: string[],
  emailSender: TransactionalEmailSender,
) {
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
      organization({
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
