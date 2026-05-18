import { createApp } from '../server/app'
import { type Auth, createAuth } from '../server/auth'
import { createDb } from '../server/db/client'
import { createEmailSender } from '../server/lib/email/sender'
import { type Env, type RuntimeConfig, validateEnv } from '../shared/env'

let cachedAuth: Auth | null = null
let cachedKey: string | null = null
let cachedDb: D1Database | null = null
let cachedEmail: Env['EMAIL'] | null = null

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const config = validateEnv(env, request.url)
    const auth = getAuth(env, config)
    return createApp(auth, { trustedOrigins: config.trustedOrigins }).fetch(request, env, ctx)
  },
}

function getAuth(env: Env, config: RuntimeConfig): Auth {
  const cacheKey = [
    config.authSecret,
    config.baseURL,
    config.emailFrom,
    config.emailFromName ?? '',
    config.trustedOrigins.join(','),
  ].join('\n')

  if (!cachedAuth || cachedKey !== cacheKey || cachedDb !== env.DB || cachedEmail !== env.EMAIL) {
    const emailSender = createEmailSender(env.EMAIL, {
      from: config.emailFrom,
      fromName: config.emailFromName,
    })

    cachedAuth = createAuth(createDb(env.DB), config.authSecret, config.baseURL, config.trustedOrigins, emailSender)
    cachedKey = cacheKey
    cachedDb = env.DB
    cachedEmail = env.EMAIL
  }

  return cachedAuth
}
