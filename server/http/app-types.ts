/**
 * Shared http-layer option/config types. Kept out of app.ts so route modules
 * (app-auth-mounts) can depend on them without importing the app assembler,
 * which would form an app <-> routes import cycle.
 */
import type { TokenExchangeServiceFactory } from '@server/composition'
import type { OnboardingRepository, SecurityRepository, UserRepository, WalletRepository } from '@server/usecases/ports'
import type { SecurityPolicy } from '@shared/api/security'
import type { AssetServiceFactory } from './routes/assets'
import type { ConfigzServiceFactory } from './routes/configz'
import type { ManagementApplicationServiceFactory, ManagementConfigzServiceFactory } from './routes/management'
import type { ConnectorServiceFactory } from './routes/management/connectors'
import type { WebhookServiceFactory } from './routes/management/webhooks'

export type AgentConfiguration = {
  issuer: string
  default_location: string
  endpoints: Record<string, string>
  [key: string]: unknown
}

export interface AppOptions {
  trustedOrigins?: string[]
  userRepository?: UserRepository
  securityRepository?: SecurityRepository
  walletRepository?: WalletRepository
  onboardingRepository?: OnboardingRepository
  securityPolicy?: SecurityPolicy
  configzServiceFactory?: ConfigzServiceFactory & ManagementConfigzServiceFactory
  applicationServiceFactory?: ManagementApplicationServiceFactory
  connectorServiceFactory?: ConnectorServiceFactory
  webhookServiceFactory?: WebhookServiceFactory
  assetServiceFactory?: AssetServiceFactory
  tokenExchangeServiceFactory?: TokenExchangeServiceFactory
}
