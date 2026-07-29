/**
 * Aggregate of the ports the usecase layer depends on. Composition (wiring
 * concrete adapters to these ports) is a later phase; this is only the shape
 * the eventual container must satisfy.
 */
import type {
  AgentAuditRepository,
  AgentIdentityRepository,
  AgentRepository,
  AgentTokenRepository,
  ApplicationRepository,
  AssetRepository,
  AssetStorage,
  AuthorizationRepository,
  ConfigzRepository,
  ConnectorRepository,
  EmailGateway,
  ExternalAccountRepository,
  ExternalHttpGateway,
  JwksGateway,
  OnboardingRepository,
  SecretCipher,
  SecurityRepository,
  TokenExchangeRepository,
  UserRepository,
  WalletRepository,
  WebhookRepository,
} from '@server/usecases/ports'

export interface Deps {
  agents: AgentRepository
  agentAudit: AgentAuditRepository
  agentIdentities: AgentIdentityRepository
  agentTokens: AgentTokenRepository
  applications: ApplicationRepository
  assets: AssetRepository
  assetStorage: AssetStorage
  authorization: AuthorizationRepository
  configz: ConfigzRepository
  connectors: ConnectorRepository
  externalAccounts: ExternalAccountRepository
  externalHttp: ExternalHttpGateway
  onboarding: OnboardingRepository
  security: SecurityRepository
  secrets: SecretCipher
  tokenExchange: TokenExchangeRepository
  users: UserRepository
  wallets: WalletRepository
  webhooks: WebhookRepository
  email: EmailGateway
  jwks: JwksGateway
}
