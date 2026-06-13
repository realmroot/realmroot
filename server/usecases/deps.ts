/**
 * Aggregate of the ports the usecase layer depends on. Composition (wiring
 * concrete adapters to these ports) is a later phase; this is only the shape
 * the eventual container must satisfy.
 */
import type {
  AgentRepository,
  ApplicationRepository,
  AssetRepository,
  AssetStorage,
  AuthorizationRepository,
  ConfigzRepository,
  ConnectorRepository,
  EmailGateway,
  JwksGateway,
  OnboardingRepository,
  SecurityRepository,
  TokenExchangeRepository,
  UserRepository,
  WalletRepository,
  WebhookRepository,
} from '@server/usecases/ports'

export interface Deps {
  agents: AgentRepository
  applications: ApplicationRepository
  assets: AssetRepository
  assetStorage: AssetStorage
  authorization: AuthorizationRepository
  configz: ConfigzRepository
  connectors: ConnectorRepository
  onboarding: OnboardingRepository
  security: SecurityRepository
  tokenExchange: TokenExchangeRepository
  users: UserRepository
  wallets: WalletRepository
  webhooks: WebhookRepository
  email: EmailGateway
  jwks: JwksGateway
}
