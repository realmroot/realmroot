import { tracing } from 'cloudflare:workers'
import { createConfiguredEmailSender, isEmailDeliveryReady } from '@server/adapters/gateways/email/sender'
import { createSecretCipher } from '@server/adapters/gateways/secrets'
import { createDrizzleConfigzRepository } from '@server/adapters/repos/configz'
import { createConnectorRepository } from '@server/adapters/repos/connectors'
import { type Auth, createAuth } from '@server/auth'
import { createDeps } from '@server/composition'
import { createDb } from '@server/db/client'
import { type Env, type RuntimeConfig, validateEnv } from '@server/env'
import { createApp, healthStatus } from '@server/http/app'
import { readCorrelationId } from '@server/http/correlation'
import {
  reconcileRealmrootResourceServer,
  synchronizeEnabledResourceScopeRegistries,
} from '@server/usecases/authorization'
import { defaultBuiltInProviders } from '@server/usecases/configz'
import { loadAuthConnectorConfig } from '@server/usecases/connectors'
import { publishWebhookEvent } from '@server/usecases/webhooks'
import { managementBuiltInProviderSettingsSchema } from '@shared/api/management'

let cachedAuth: Auth | null = null
let cachedKey: string | null = null
let cachedStaticKey: string | null = null
let cachedValidatedAt = 0
let cachedDb: D1Database | null = null
let cachedEmail: Env['EMAIL'] | null = null
let cachedSecurityPolicy: RuntimeConfig['securityPolicy'] | null = null
let cachedSecurityPolicyDb: D1Database | null = null
let cachedSecurityPolicyAt = 0
let reconciledBaseURL: string | null = null
const dynamicConfigRefreshIntervalMs = 5_000
const publicMetadataCacheControl = 'public, max-age=15, stale-while-revalidate=15, stale-if-error=86400'
const cachedPublicMetadataPaths = new Set(['/.well-known/agent-configuration'])
const emailVerificationPolicyPaths = new Set([
  '/api/auth/sign-up/email',
  '/api/auth/sign-in/email',
  '/api/auth/sign-in/username',
])

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Liveness probe answers from the process alone — before any D1 read — so it
    // reports the worker is up even when the database is unmigrated or down.
    const path = new URL(request.url).pathname
    if (path === '/api/health') return Response.json(healthStatus)
    const publicMetadataCache =
      request.method === 'GET' && cachedPublicMetadataPaths.has(path)
        ? await caches.open('realmroot-public-metadata')
        : null
    const cached = await publicMetadataCache?.match(request)
    if (cached) return cached
    return tracing.enterSpan('realmroot.request.prepare', async (span) => {
      span.setAttribute('url.path', path)
      const config = validateEnv(env, request.url)
      const correlationId = readCorrelationId(request.headers.get('x-correlation-id')) ?? undefined
      if (correlationId) span.setAttribute('realmroot.correlation_id', correlationId)
      const deps = createDeps(env, config, correlationId)
      const resourceTokenRequest = request.headers.get('authorization')?.startsWith('DPoP ') ?? false
      const [, securityPolicy] = await Promise.all([
        reconcileResourceOnce(deps, config.baseURL),
        tracing.enterSpan('realmroot.security-policy.load', () =>
          resourceTokenRequest
            ? Promise.resolve(cachedSecurityPolicy ?? config.securityPolicy)
            : loadSecurityPolicy(env, deps),
        ),
      ])
      const auth = await tracing.enterSpan('realmroot.auth.prepare', () =>
        getAuth(env, { ...config, securityPolicy }, deps, resourceTokenRequest, emailVerificationPolicyPaths.has(path)),
      )
      const response = await tracing.enterSpan('realmroot.router.dispatch', () =>
        createApp(auth, deps, {
          baseURL: config.baseURL,
          trustedOrigins: config.trustedOrigins,
          securityPolicy,
          realmrootResourceReconciled: true,
        }).fetch(request, env, ctx),
      )
      if (!publicMetadataCache || !response.ok) return response
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', publicMetadataCacheControl)
      const cacheable = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
      ctx.waitUntil(publicMetadataCache.put(request, cacheable.clone()))
      return cacheable
    })
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const config = validateEnv(env, env.BETTER_AUTH_URL ?? 'https://scheduled.realmroot.invalid')
    ctx.waitUntil(synchronizeEnabledResourceScopeRegistries(createDeps(env, config)))
  },
}

async function getAuth(
  env: Env,
  config: RuntimeConfig,
  deps: ReturnType<typeof createDeps>,
  resourceTokenRequest = false,
  forceDynamicRefresh = false,
): Promise<Auth> {
  const staticKey = [
    config.authSecret,
    config.baseURL,
    config.emailFrom ?? '',
    config.emailFromName ?? '',
    config.trustedOrigins.join(','),
    JSON.stringify(config.securityPolicy),
  ].join('\n')
  if (
    cachedAuth &&
    cachedStaticKey === staticKey &&
    cachedDb === env.DB &&
    cachedEmail === env.EMAIL &&
    !forceDynamicRefresh &&
    (resourceTokenRequest || Date.now() - cachedValidatedAt < dynamicConfigRefreshIntervalMs)
  ) {
    return cachedAuth
  }
  const db = createDb(env.DB)
  const configz = createDrizzleConfigzRepository(db)
  const [connectors, validAudiences, settings, emailSettings] = await Promise.all([
    loadAuthConnectorConfig(createConnectorRepository(db, createSecretCipher(config.credentialEncryptionKey))),
    loadValidAudiences(env.DB, config.baseURL),
    configz.getSettings(),
    configz.getEmailSettings(),
  ])
  const storedBuiltInProviders = settings?.metadata?.builtInProviders
  const builtInProviders = managementBuiltInProviderSettingsSchema.parse(
    mergeBuiltInProviders(defaultBuiltInProviders, storedBuiltInProviders),
  )
  const cacheKey = [
    config.authSecret,
    config.baseURL,
    config.emailFrom ?? '',
    config.emailFromName ?? '',
    config.trustedOrigins.join(','),
    JSON.stringify(config.securityPolicy),
    JSON.stringify(builtInProviders ?? {}),
    JSON.stringify(emailSettings),
    connectors.cacheKey,
    validAudiences.join(','),
  ].join('\n')

  if (!cachedAuth || cachedKey !== cacheKey || cachedDb !== env.DB || cachedEmail !== env.EMAIL) {
    const fallbackEmailSender = config.emailFrom
      ? { from: config.emailFrom, ...(config.emailFromName ? { fromName: config.emailFromName } : {}) }
      : undefined
    const emailSender = createConfiguredEmailSender(env.EMAIL, () => configz.getEmailSettings(), fallbackEmailSender)

    cachedAuth = createAuth(
      db,
      deps.ids,
      config.authSecret,
      config.baseURL,
      config.trustedOrigins,
      emailSender,
      config.securityPolicy,
      connectors,
      {
        builtInProviders,
        emailDeliveryReady: isEmailDeliveryReady(env.EMAIL, emailSettings, fallbackEmailSender),
        twoFactorEmailOtpEnabled: config.securityPolicy.mfa.emailOtpEnabled,
        validAudiences,
        externalHttp: deps.externalHttp,
        publishWebhookEvent: async (event, data) => {
          await publishWebhookEvent(deps, event, data)
        },
      },
    )
    cachedKey = cacheKey
    cachedStaticKey = staticKey
    cachedDb = env.DB
    cachedEmail = env.EMAIL
  }
  cachedValidatedAt = Date.now()

  return cachedAuth
}

async function loadSecurityPolicy(env: Env, deps: ReturnType<typeof createDeps>) {
  if (
    cachedSecurityPolicy &&
    cachedSecurityPolicyDb === env.DB &&
    Date.now() - cachedSecurityPolicyAt < dynamicConfigRefreshIntervalMs
  ) {
    return cachedSecurityPolicy
  }
  cachedSecurityPolicy = await deps.security.getPolicy()
  cachedSecurityPolicyDb = env.DB
  cachedSecurityPolicyAt = Date.now()
  return cachedSecurityPolicy
}

async function reconcileResourceOnce(deps: ReturnType<typeof createDeps>, baseURL: string) {
  if (reconciledBaseURL === baseURL) return
  await tracing.enterSpan('realmroot.resource.reconcile', () => reconcileRealmrootResourceServer(deps, baseURL))
  reconciledBaseURL = baseURL
}

async function loadValidAudiences(db: D1Database, baseURL: string) {
  const result = await db
    .prepare('SELECT resource_url FROM api_resource WHERE enabled = 1 ORDER BY resource_url')
    .all<{ resource_url: string }>()
  return [baseURL, ...result.results.map((row) => row.resource_url)]
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
