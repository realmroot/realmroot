/**
 * Composition root: the only place adapters are constructed and wired to
 * usecases. `createDeps(env, config)` is request-free so the fetch/scheduled
 * entrypoints can share it. Usecases are now free functions that take `deps`,
 * so the http layer reads `deps` from request context instead of per-request
 * service factories.
 */
import { createConfiguredEmailSender } from '@server/adapters/gateways/email/sender'
import { createJwksGateway } from '@server/adapters/gateways/jwks'
import { createSecretCipher } from '@server/adapters/gateways/secrets'
import { createUuidV7IdentifierGenerator } from '@server/adapters/identifiers/uuid-v7'
import { createAgentAuditRepository } from '@server/adapters/repos/agent-audit'
import { createDrizzleAgentIdentityRepository } from '@server/adapters/repos/agent-identities'
import { createDrizzleAgentTokenRepository } from '@server/adapters/repos/agent-tokens'
import { createDrizzleAgentRepository } from '@server/adapters/repos/agents'
import { createDrizzleApplicationRepository } from '@server/adapters/repos/applications'
import { createDrizzleAssetRepository } from '@server/adapters/repos/assets'
import { createDrizzleAuthorizationRepository } from '@server/adapters/repos/authorization'
import { createDrizzleConfigzRepository } from '@server/adapters/repos/configz'
import { createConnectorRepository } from '@server/adapters/repos/connectors'
import { createExternalResourceRepository } from '@server/adapters/repos/external-resources'
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
  const ids = createUuidV7IdentifierGenerator()
  const secrets = createSecretCipher(config.credentialEncryptionKey)
  const configz = createDrizzleConfigzRepository(db)
  return {
    ids,
    agents: createDrizzleAgentRepository(db),
    agentAudit: createAgentAuditRepository(db),
    agentIdentities: createDrizzleAgentIdentityRepository(db),
    agentTokens: createDrizzleAgentTokenRepository(db),
    applications: createDrizzleApplicationRepository(db, ids),
    assets: createDrizzleAssetRepository(db),
    assetStorage: env.ASSET_BUCKET,
    authorization: createDrizzleAuthorizationRepository(db, ids),
    configz,
    connectors: createConnectorRepository(db, secrets),
    externalResources: createExternalResourceRepository(db, ids),
    externalHttp: { fetch: (request) => (env.EXTERNAL_HTTP ? env.EXTERNAL_HTTP.fetch(request) : fetch(request)) },
    onboarding: createOnboardingRepository(env.DB, ids),
    security: createSecurityRepository(db, config.securityPolicy),
    secrets,
    tokenExchange: createTokenExchangeRepository(db, ids),
    users: createUserRepository(db, ids),
    wallets: createWalletRepository(db, ids),
    webhooks: createWebhookRepository(db),
    email: createConfiguredEmailSender(
      env.EMAIL,
      () => configz.getEmailSettings(),
      config.emailFrom
        ? { from: config.emailFrom, ...(config.emailFromName ? { fromName: config.emailFromName } : {}) }
        : undefined,
    ),
    jwks: createJwksGateway(),
  }
}
