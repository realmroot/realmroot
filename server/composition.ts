/**
 * Composition root: the only place adapters are constructed and wired to
 * usecases. `createDeps(env, config)` is request-free so the fetch/scheduled
 * entrypoints can share it. The per-request service factories below build
 * usecases that need request-bound data (the issuer/origin derived from the
 * request URL) and are consumed by the http layer through AppOptions.
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
import { AgentService } from '@server/usecases/agents'
import { ApplicationService } from '@server/usecases/applications'
import { AssetService } from '@server/usecases/assets'
import { AuthorizationService } from '@server/usecases/authorization'
import { ConfigzService } from '@server/usecases/configz'
import { ConnectorService, loadAuthConnectorConfig } from '@server/usecases/connectors'
import type { Deps } from '@server/usecases/deps'
import type { OnboardingRepository } from '@server/usecases/ports'
import { TokenExchangeService } from '@server/usecases/token-exchange'
import { WebhookService } from '@server/usecases/webhooks'
import type { SecurityPolicy } from '@shared/api/security'
import type { Env, RuntimeConfig } from '@shared/env'
import type { Context } from 'hono'
import { createDb } from './db/client'

export interface ApplicationBindings {
  DB: D1Database
}

export type ConnectorBindings = ApplicationBindings
export type WebhookBindings = ApplicationBindings

export interface AssetBindings {
  ASSET_BUCKET: R2Bucket
  DB: D1Database
}

export interface ConfigzBindings {
  DB: D1Database
}

export interface AgentBindings {
  DB: D1Database
}

export interface AuthorizationBindings {
  DB: D1Database
}

export interface TokenExchangeBindings {
  DB: D1Database
}

export interface ConfigzRuntimeOptions {
  onboardingRepository?: OnboardingRepository
  securityPolicy?: SecurityPolicy
}

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

export function createApplicationService(c: Context<{ Bindings: ApplicationBindings }>) {
  const url = new URL(c.req.url)
  const issuer = `${url.protocol}//${url.host}`
  return new ApplicationService(createDrizzleApplicationRepository(createDb(c.env.DB)), { issuer })
}

export function createAssetService(c: Context<{ Bindings: AssetBindings }>) {
  const url = new URL(c.req.url)
  return new AssetService(createDrizzleAssetRepository(createDb(c.env.DB)), c.env.ASSET_BUCKET, url.origin)
}

export function createAuthorizationService(c: Context<{ Bindings: AuthorizationBindings }>) {
  return new AuthorizationService(createDrizzleAuthorizationRepository(createDb(c.env.DB)))
}

export function createAgentService(c: Context<{ Bindings: AgentBindings }>) {
  const db = createDb(c.env.DB)
  return new AgentService(createUserRepository(db), createDrizzleAgentRepository(db))
}

export function createConnectorService(c: Context<{ Bindings: ConnectorBindings }>) {
  return new ConnectorService(createConnectorRepository(createDb(c.env.DB)))
}

export function createTokenExchangeService(c: Context<{ Bindings: TokenExchangeBindings }>) {
  return new TokenExchangeService(createTokenExchangeRepository(createDb(c.env.DB)), createJwksGateway())
}

export function createWebhookService(c: Context<{ Bindings: WebhookBindings }>) {
  return new WebhookService(createWebhookRepository(createDb(c.env.DB)))
}

export function createConfigzService(c: Context<{ Bindings: ConfigzBindings }>, options: ConfigzRuntimeOptions = {}) {
  const url = new URL(c.req.url)
  const issuer = `${url.protocol}//${url.host}`
  return new ConfigzService(createDrizzleConfigzRepository(createDb(c.env.DB)), {
    issuer,
    emailOtpEnabled: true,
    usernameEnabled: true,
    onboardingRepository: options.onboardingRepository,
    securityPolicy: options.securityPolicy,
    availableIdentityProviderIds: async () => {
      const configResult = await loadAuthConnectorConfig(createConnectorRepository(createDb(c.env.DB)))
      return new Set(configResult.trustedProviders)
    },
  })
}
