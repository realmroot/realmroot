/**
 * Composition root: the only place adapters are constructed and wired to
 * usecases. `createDeps(env, config)` is request-free so the fetch/scheduled
 * entrypoints can share it. Usecases are now free functions that take `deps`,
 * so the http layer reads `deps` from request context instead of per-request
 * service factories.
 */
import { createEmailSender } from '@server/adapters/gateways/email/sender'
import { createJwksGateway } from '@server/adapters/gateways/jwks'
import { createDrizzleAgentRepository } from '@server/adapters/repos/agents'
import { createDrizzleApplicationRepository } from '@server/adapters/repos/applications'
import { createDrizzleAssetRepository } from '@server/adapters/repos/assets'
import { createDrizzleAuthorizationRepository } from '@server/adapters/repos/authorization'
import { createDrizzleConfigzRepository } from '@server/adapters/repos/configz'
import { createConnectorRepository } from '@server/adapters/repos/connectors'
import { createOnboardingRepository } from '@server/adapters/repos/onboarding'
import { createSecurityRepository } from '@server/adapters/repos/security'
import { createTokenExchangeRepository } from '@server/adapters/repos/token-exchange'
import { createUserRepository } from '@server/adapters/repos/users'
import { createWalletRepository } from '@server/adapters/repos/wallets'
import { createWebhookRepository } from '@server/adapters/repos/webhooks'
import type { Env, RuntimeConfig } from '@server/env'
import type { Deps } from '@server/usecases/deps'
import { createDb } from './db/client'

/**
 * Build every adapter once from the environment. Request-free: callable from the
 * fetch handler, scheduled handlers, or queue consumers.
 */
export function createDeps(env: Env, config: RuntimeConfig): Deps {
  const db = createDb(env.DB)
  return {
    agents: createDrizzleAgentRepository(db),
    applications: createDrizzleApplicationRepository(db),
    assets: createDrizzleAssetRepository(db),
    assetStorage: env.ASSET_BUCKET,
    authorization: createDrizzleAuthorizationRepository(db),
    configz: createDrizzleConfigzRepository(db),
    connectors: createConnectorRepository(db),
    onboarding: createOnboardingRepository(env.DB),
    security: createSecurityRepository(db, config.securityPolicy),
    tokenExchange: createTokenExchangeRepository(db),
    users: createUserRepository(db),
    wallets: createWalletRepository(db),
    webhooks: createWebhookRepository(db),
    email: createEmailSender(env.EMAIL, { from: config.emailFrom, fromName: config.emailFromName }),
    jwks: createJwksGateway(),
  }
}
