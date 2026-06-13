import { env } from 'cloudflare:test'
import { createEmailSender } from '@server/adapters/gateways/email/sender'
import { createAuth } from '@server/auth'
import { createDeps } from '@server/composition'
import { createDb } from '@server/db/client'
import type { Env, RuntimeConfig } from '@server/env'
import { createApp } from '@server/http/app'
import { ensureSystemClients } from '@server/usecases/applications'
import type { SecurityPolicy } from '@shared/api/security'

export const baseURL = 'http://localhost'
const authSecret = 'integration-secret-with-enough-entropy-2026-flareauth'

/**
 * The crown wires the real composition root over the pool's real D1. Only the
 * outward network/storage gateways (email, R2) are stubbed at the env boundary
 * — every repository, usecase, and SQL statement is the production code path.
 */
function integrationEnv(): Env {
  return {
    DB: env.DB,
    ASSET_BUCKET: noopBucket(),
    EMAIL: { send: async () => ({ messageId: 'integration' }) },
    EMAIL_QUEUE: { send: async () => {}, sendBatch: async () => {} },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    BETTER_AUTH_SECRET: authSecret,
    BETTER_AUTH_URL: baseURL,
    TRUSTED_ORIGINS: baseURL,
    EMAIL_FROM: 'noreply@example.com',
    EMAIL_FROM_NAME: 'FlareAuth',
  } as unknown as Env
}

function integrationConfig(): RuntimeConfig {
  return {
    authSecret,
    baseURL,
    emailFrom: 'noreply@example.com',
    emailFromName: 'FlareAuth',
    trustedOrigins: [baseURL],
    securityPolicy: integrationSecurityPolicy(),
  }
}

function integrationSecurityPolicy(): SecurityPolicy {
  return {
    mfa: { mode: 'optional', authenticatorAppEnabled: true, emailOtpEnabled: false, backupCodesEnabled: true },
    passkeys: { enabled: true, rpId: 'localhost', rpName: 'FlareAuth', origins: [baseURL] },
    sessions: {
      expiresInSeconds: 60 * 60 * 24 * 7,
      updateAgeSeconds: 60 * 60 * 24,
      freshAgeSeconds: 60 * 60 * 24,
      cookieCacheSeconds: 60 * 5,
    },
    password: {
      minLength: 8,
      requiredCharacterTypes: 1,
      customWords: [],
      rejectUserInfo: false,
      rejectSequential: false,
      rejectCustomWords: false,
    },
    captcha: { enabled: false, provider: 'turnstile', siteKey: '', secretBinding: '' },
    blocklist: { blockSubaddressing: false, entries: [] },
  } as SecurityPolicy
}

export interface Harness {
  app: ReturnType<typeof createApp>
  request: (input: string, init?: RequestInit) => Promise<Response>
}

/**
 * Build the production app over real D1. System OAuth clients are seeded the
 * same way `worker.ts` does so management/token endpoints behave for real.
 */
export async function createHarness(): Promise<Harness> {
  const config = integrationConfig()
  const deps = createDeps(integrationEnv(), config)
  await ensureSystemClients(deps, config.baseURL)

  const db = createDb(env.DB)
  const emailSender = createEmailSender(integrationEnv().EMAIL, {
    from: config.emailFrom,
    fromName: config.emailFromName,
  })
  const auth = createAuth(
    db,
    config.authSecret,
    config.baseURL,
    config.trustedOrigins,
    emailSender,
    config.securityPolicy,
  )

  const app = createApp(auth, deps, {
    trustedOrigins: config.trustedOrigins,
    securityPolicy: config.securityPolicy,
  })

  return {
    app,
    request: async (input, init) => app.request(new URL(input, baseURL).toString(), init),
  }
}

function noopBucket() {
  return {
    put: async () => ({}),
    get: async () => null,
    head: async () => null,
    delete: async () => {},
    list: async () => ({ objects: [] }),
  }
}
