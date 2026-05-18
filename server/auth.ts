import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, jwt } from 'better-auth/plugins'
import type { Database } from './db/client'
import * as schema from './db/schema'
import { hashPassword, verifyPassword } from './lib/password'

const oauthScopes = ['openid', 'profile', 'email', 'offline_access']

export function createAuth(db: Database, secret: string, baseURL: string, trustedOrigins: string[]) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    secret,
    baseURL,
    disabledPaths: ['/token'],
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
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
