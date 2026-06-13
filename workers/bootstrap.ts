import { createEmailSender } from '@server/adapters/gateways/email/sender'
import { createDrizzleApplicationRepository } from '@server/adapters/repos/applications'
import { createDrizzleConfigzRepository } from '@server/adapters/repos/configz'
import { createConnectorRepository } from '@server/adapters/repos/connectors'
import { createOnboardingRepository } from '@server/adapters/repos/onboarding'
import { createSecurityRepository } from '@server/adapters/repos/security'
import { createUserRepository } from '@server/adapters/repos/users'
import { createWalletRepository } from '@server/adapters/repos/wallets'
import { createApp } from '../server/app'
import { type Auth, createAuth } from '../server/auth'
import { createDb } from '../server/db/client'
import { ApplicationService } from '../server/modules/applications/service'
import { createConfigzService } from '../server/modules/configz/context'
import { createTokenExchangeService } from '../server/modules/token-exchange/context'
import { defaultBuiltInProviders } from '../server/usecases/configz'
import { loadAuthConnectorConfig } from '../server/usecases/connectors'
import { managementBuiltInProviderSettingsSchema } from '../shared/api/management'
import { type Env, type RuntimeConfig, validateEnv } from '../shared/env'

let cachedAuth: Auth | null = null
let cachedKey: string | null = null
let cachedDb: D1Database | null = null
let cachedEmail: Env['EMAIL'] | null = null
let cachedSystemClientDb: D1Database | null = null

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const config = validateEnv(env, request.url)
    const db = createDb(env.DB)
    const securityRepository = createSecurityRepository(db, config.securityPolicy)
    const securityPolicy = await securityRepository.getPolicy()
    await ensureSystemClients(env.DB, db, config.baseURL)
    const auth = await getAuth(env, { ...config, securityPolicy })
    return createApp(auth, {
      trustedOrigins: config.trustedOrigins,
      userRepository: createUserRepository(db),
      walletRepository: createWalletRepository(db),
      securityRepository,
      onboardingRepository: createOnboardingRepository(env.DB),
      securityPolicy,
      configzServiceFactory: createConfigzService,
      tokenExchangeServiceFactory: createTokenExchangeService,
    }).fetch(request, env, ctx)
  },
}

async function ensureSystemClients(rawDb: D1Database, db: ReturnType<typeof createDb>, issuer: string) {
  if (cachedSystemClientDb === rawDb) return
  await new ApplicationService(createDrizzleApplicationRepository(db), { issuer }).ensureSystemClients()
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
