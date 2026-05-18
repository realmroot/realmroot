import { createApp } from '../server/app'
import { type Auth, createAuth } from '../server/auth'
import { createDb } from '../server/db/client'
import { createEmailSender } from '../server/lib/email/sender'
import { createConnectorRepository } from '../server/modules/connectors/repository'
import { loadAuthConnectorConfig } from '../server/modules/connectors/service'
import { createSecurityRepository } from '../server/modules/security/repository'
import { createUserRepository } from '../server/modules/users/repository'
import { type Env, type RuntimeConfig, validateEnv } from '../shared/env'

let cachedAuth: Auth | null = null
let cachedKey: string | null = null
let cachedDb: D1Database | null = null
let cachedEmail: Env['EMAIL'] | null = null

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const config = validateEnv(env, request.url)
    const auth = await getAuth(env, config)
    const db = createDb(env.DB)
    return createApp(auth, {
      trustedOrigins: config.trustedOrigins,
      userRepository: createUserRepository(db),
      securityRepository: createSecurityRepository(db, config.securityPolicy),
      securityPolicy: config.securityPolicy,
    }).fetch(request, env, ctx)
  },
}

async function getAuth(env: Env, config: RuntimeConfig): Promise<Auth> {
  const db = createDb(env.DB)
  const connectors = await loadAuthConnectorConfig(createConnectorRepository(db), env)
  const cacheKey = [
    config.authSecret,
    config.baseURL,
    config.emailFrom,
    config.emailFromName ?? '',
    config.trustedOrigins.join(','),
    JSON.stringify(config.securityPolicy),
    connectors.cacheKey,
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
    )
    cachedKey = cacheKey
    cachedDb = env.DB
    cachedEmail = env.EMAIL
  }

  return cachedAuth
}
