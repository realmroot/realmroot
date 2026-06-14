import { createEmailSender } from '@server/adapters/gateways/email/sender'
import { createDrizzleConfigzRepository } from '@server/adapters/repos/configz'
import { createConnectorRepository } from '@server/adapters/repos/connectors'
import { type Auth, createAuth } from '@server/auth'
import { createDeps } from '@server/composition'
import { createDb } from '@server/db/client'
import { type Env, type RuntimeConfig, validateEnv } from '@server/env'
import { createApp, healthStatus } from '@server/http/app'
import { ensureSystemClients as ensureSystemClientsUsecase } from '@server/usecases/applications'
import { defaultBuiltInProviders } from '@server/usecases/configz'
import { loadAuthConnectorConfig } from '@server/usecases/connectors'
import type { Deps } from '@server/usecases/deps'
import { managementBuiltInProviderSettingsSchema } from '@shared/api/management'

let cachedAuth: Auth | null = null
let cachedKey: string | null = null
let cachedDb: D1Database | null = null
let cachedEmail: Env['EMAIL'] | null = null
let cachedSystemClientDb: D1Database | null = null

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Liveness probe answers from the process alone — before any D1 read — so it
    // reports the worker is up even when the database is unmigrated or down.
    if (new URL(request.url).pathname === '/api/health') return Response.json(healthStatus)
    const config = validateEnv(env, request.url)
    const deps = createDeps(env, config)
    const securityPolicy = await deps.security.getPolicy()
    await ensureSystemClients(env.DB, deps, config.baseURL)
    const auth = await getAuth(env, { ...config, securityPolicy })
    return createApp(auth, deps, {
      trustedOrigins: config.trustedOrigins,
      securityPolicy,
    }).fetch(request, env, ctx)
  },
}

async function ensureSystemClients(rawDb: D1Database, deps: Deps, issuer: string) {
  if (cachedSystemClientDb === rawDb) return
  await ensureSystemClientsUsecase(deps, issuer)
  cachedSystemClientDb = rawDb
}

async function getAuth(env: Env, config: RuntimeConfig): Promise<Auth> {
  const db = createDb(env.DB)
  const connectors = await loadAuthConnectorConfig(createConnectorRepository(db))
  const validAudiences = await loadValidAudiences(env.DB, config.baseURL)
  const storedBuiltInProviders = (await createDrizzleConfigzRepository(db).getSettings())?.metadata?.builtInProviders
  const builtInProviders = managementBuiltInProviderSettingsSchema.parse(
    mergeBuiltInProviders(defaultBuiltInProviders, storedBuiltInProviders),
  )
  const cacheKey = [
    config.authSecret,
    config.baseURL,
    config.emailFrom,
    config.emailFromName ?? '',
    config.trustedOrigins.join(','),
    JSON.stringify(config.securityPolicy),
    JSON.stringify(builtInProviders ?? {}),
    connectors.cacheKey,
    validAudiences.join(','),
  ].join('\n')

  if (!cachedAuth || cachedKey !== cacheKey || cachedDb !== env.DB || cachedEmail !== env.EMAIL) {
    const emailSender = createEmailSender(env.EMAIL, {
      from: config.emailFrom,
      fromName: config.emailFromName,
    })

    cachedAuth = createAuth(
      db,
      config.authSecret,
      config.baseURL,
      config.trustedOrigins,
      emailSender,
      config.securityPolicy,
      connectors,
      {
        builtInProviders,
        twoFactorEmailOtpEnabled: config.securityPolicy.mfa.emailOtpEnabled,
        validAudiences,
      },
    )
    cachedKey = cacheKey
    cachedDb = env.DB
    cachedEmail = env.EMAIL
  }

  return cachedAuth
}

async function loadValidAudiences(db: D1Database, baseURL: string) {
  const result = await db
    .prepare('SELECT audience FROM api_resource WHERE enabled = 1 ORDER BY audience')
    .all<{ audience: string }>()
  return [baseURL, ...result.results.map((row) => row.audience)]
}

function mergeBuiltInProviders(
  defaults: typeof defaultBuiltInProviders,
  stored: unknown,
): typeof defaultBuiltInProviders {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaults
  const input = stored as Partial<Record<keyof typeof defaultBuiltInProviders, unknown>>
  return {
    email: mergeProvider(defaults.email, input.email),
    phone: mergeProvider(defaults.phone, input.phone),
    web3Wallet: mergeProvider(defaults.web3Wallet, input.web3Wallet),
    passkey: mergeProvider(defaults.passkey, input.passkey),
    oneTap: mergeProvider(defaults.oneTap, input.oneTap),
  }
}

function mergeProvider<T extends Record<string, unknown>>(defaults: T, stored: unknown): T {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaults
  return { ...defaults, ...stored }
}
