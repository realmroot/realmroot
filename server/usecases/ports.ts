/**
 * Ports: the interfaces the usecases depend on for everything beyond the
 * process boundary (persistence, external services). Adapters implement these;
 * usecases consume them. Port records are plain, framework-free shapes — they
 * never reference the drizzle schema, so this file stays inside the usecase
 * layer's dependency budget.
 */
import type { AccountProfileUpdateInput } from '@shared/api/account'
import type {
  ApplicationOidcClaims,
  ApplicationResponse,
  PaginationMetadata,
  PaginationQuery,
} from '@shared/api/applications'
import type { AssetPurpose } from '@shared/api/assets'
import type {
  ApiResourceResponse,
  AssignRoleRequest,
  InvitationResponse,
  MemberResponse,
  OrganizationResponse,
  RoleResponse,
  UpdateApiResourceRequest,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
} from '@shared/api/authorization'
import type { ConfigzConfigResponse } from '@shared/api/configz'
import type { UpdateManagementSignInSettingsRequest } from '@shared/api/management'
import type { OnboardingAdminRequest } from '@shared/api/onboarding'
import type { PaginatedResult, PaginationInput } from '@shared/api/pagination'
import type { SecurityPolicy, UpdateSecurityPolicyInput } from '@shared/api/security'
import type { AdminCreateUserInput, AdminUpdateUserInput, AdminUserListQuery } from '@shared/api/users'
import type { ListWebhookEndpointsQuery, ListWebhookRequestsQuery } from '@shared/api/webhooks'

// --- assets -----------------------------------------------------------------

export interface UploadedAssetRecord {
  id: string
  purpose: AssetPurpose
  storageKey: string
  publicUrl: string
  contentType: string
  byteSize: number
  checksumSha256: string
  createdByUserId: string | null
  createdAt: Date
}

export interface AssetRepository {
  createAsset(input: Omit<UploadedAssetRecord, 'createdAt'>): Promise<UploadedAssetRecord>
  findAsset(id: string): Promise<UploadedAssetRecord | null>
  updateUserAvatar(userId: string, assetId: string, publicUrl: string): Promise<void>
  updateApplicationLogo(applicationId: string, assetId: string, publicUrl: string): Promise<void>
  updateOrganizationLogo(organizationId: string, assetId: string, publicUrl: string): Promise<void>
  updateBrandingAsset(kind: 'logo' | 'favicon', assetId: string): Promise<void>
}

export interface AssetStorage {
  put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>
  get(key: string): Promise<R2ObjectBody | null>
}

// --- webhooks ---------------------------------------------------------------

export interface WebhookEndpointRecord {
  id: string
  url: string
  events: string[]
  enabled: boolean
  signingSecret: string
  secretPrefix: string
  createdByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface WebhookEndpointInsert {
  id: string
  url: string
  events: string[]
  enabled?: boolean
  signingSecret: string
  secretPrefix: string
  createdByUserId?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export interface WebhookRequestRecord {
  id: string
  endpointId: string
  event: string
  status: string
  attemptCount: number
  httpStatus: number | null
  error: string | null
  requestBody: string | null
  responseBody: string | null
  nextAttemptAt: Date | null
  createdAt: Date
  updatedAt: Date
  endpointUrl: string
}

export interface WebhookRequestInsert {
  id?: string
  endpointId?: string
  event?: string
  status?: string
  attemptCount?: number
  httpStatus?: number | null
  error?: string | null
  requestBody?: string | null
  responseBody?: string | null
  nextAttemptAt?: Date | null
  createdAt?: Date
  updatedAt?: Date
}

export interface WebhookRepository {
  listEndpoints(query: ListWebhookEndpointsQuery): Promise<{ items: WebhookEndpointRecord[]; total: number }>
  findEndpoint(id: string): Promise<WebhookEndpointRecord | null>
  createEndpoint(input: WebhookEndpointInsert): Promise<WebhookEndpointRecord>
  updateEndpoint(id: string, input: Partial<WebhookEndpointInsert>): Promise<WebhookEndpointRecord | null>
  deleteEndpoint(id: string): Promise<void>
  listRequests(query: ListWebhookRequestsQuery): Promise<{ items: WebhookRequestRecord[]; total: number }>
  findRequest(id: string): Promise<WebhookRequestRecord | null>
  updateRequest(id: string, input: Partial<WebhookRequestInsert>): Promise<WebhookRequestRecord | null>
}

// --- users ------------------------------------------------------------------

export interface UserProfile {
  id: string
  email: string
  emailVerified: boolean
  displayName: string
  username: string | null
  avatarAssetId: string | null
  image: string | null
  role: string | null
  banned: boolean | null
  banReason: string | null
  banExpires: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface UserSessionDevice {
  id: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  ipAddress: string | null
  userAgent: string | null
  activeOrganizationId: string | null
  impersonatedBy: string | null
}

export interface LinkedAccount {
  id: string
  accountId: string
  providerId: string
  createdAt: Date
  updatedAt: Date
}

export interface ConsentedApplication {
  id: string
  applicationId: string
  applicationName: string
  applicationSlug: string
  scopes: string[]
  permissions: string[] | null
  grantedAt: Date
  expiresAt: Date | null
}

export interface UserRepository {
  getUser(userId: string): Promise<UserProfile>
  listManagedUsers(query: AdminUserListQuery): Promise<PaginatedResult<UserProfile>>
  createManagedUser(input: AdminCreateUserInput): Promise<UserProfile>
  updateManagedUser(userId: string, input: AdminUpdateUserInput): Promise<UserProfile>
  deleteManagedUser(userId: string): Promise<void>
  updateProfile(userId: string, input: AccountProfileUpdateInput): Promise<UserProfile>
  assertAccountAvatarReference(userId: string, avatarAssetId: string | null | undefined): Promise<void>
  assertAdminAvatarReference(avatarAssetId: string | null | undefined): Promise<void>
  listLinkedAccounts(userId: string, page: PaginationInput): Promise<PaginatedResult<LinkedAccount>>
  listConsentedApplications(userId: string, page: PaginationInput): Promise<PaginatedResult<ConsentedApplication>>
  listSessions(userId: string, page: PaginationInput): Promise<PaginatedResult<UserSessionDevice>>
  getSessionToken(userId: string, sessionId: string): Promise<string>
}

// --- security ---------------------------------------------------------------

export interface SecurityPasskey {
  id: string
  name: string | null
  userId: string
  deviceType: string
  backedUp: boolean
  transports: string | null
  createdAt: Date | null
  aaguid: string | null
}

export interface MfaFactor {
  id: string
  type: 'totp'
  verified: boolean | null
}

export interface SecurityState {
  userId: string
  mfa: {
    enabled: boolean
    factors: MfaFactor[]
  }
  passkeys: {
    enabled: boolean
    count: number
  }
  policy: SecurityPolicy
}

export interface SecurityRepository {
  getPolicy(): Promise<SecurityPolicy>
  updatePolicy(input: UpdateSecurityPolicyInput): Promise<SecurityPolicy>
  getSecurityState(userId: string): Promise<SecurityState>
  listPasskeys(userId: string, page: PaginationInput): Promise<PaginatedResult<SecurityPasskey>>
  deletePasskey(userId: string, passkeyId: string): Promise<void>
  getSessionToken(userId: string, sessionId: string): Promise<string>
}

// --- wallets ----------------------------------------------------------------

export interface WalletAddressRecord {
  id: string
  userId: string
  address: string
  chainId: number
  isPrimary: boolean | null
  createdAt: Date
}

export interface WalletRepository {
  findWalletAddress(address: string, chainId: number): Promise<WalletAddressRecord | null>
  findAnyWalletAddress(address: string): Promise<WalletAddressRecord | null>
  getSiweNonce(address: string, chainId: number): Promise<{ value: string; expiresAt: Date } | null>
  deleteSiweNonce(address: string, chainId: number): Promise<void>
  linkWalletAddress(userId: string, input: { address: string; chainId: number }): Promise<WalletAddressRecord>
  unlinkWalletAddress(userId: string, accountId: string): Promise<void>
}

// --- onboarding -------------------------------------------------------------

export interface BootstrapAdminInput extends OnboardingAdminRequest {
  passwordHash: string
}

export interface OnboardingRepository {
  hasUsers(): Promise<boolean>
  createBootstrapAdmin(input: BootstrapAdminInput): Promise<{ id: string; email: string; role: string | null }>
}

// --- connectors -------------------------------------------------------------

export interface ConnectorRecord {
  id: string
  slug: string
  providerType: string
  providerId: string
  displayName: string
  enabled: boolean
  clientId: string | null
  clientSecret: string | null
  issuer: string | null
  authorizationEndpoint: string | null
  tokenEndpoint: string | null
  userInfoEndpoint: string | null
  jwksEndpoint: string | null
  scopes: string[] | null
  attributeMapping: Record<string, string> | null
  providerMetadata: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface ConnectorRecordInput {
  id: string
  slug: string
  providerType: string
  providerId: string
  displayName: string
  enabled?: boolean
  clientId?: string | null
  clientSecret?: string | null
  issuer?: string | null
  authorizationEndpoint?: string | null
  tokenEndpoint?: string | null
  userInfoEndpoint?: string | null
  jwksEndpoint?: string | null
  scopes?: string[] | null
  attributeMapping?: Record<string, string> | null
  providerMetadata?: Record<string, unknown> | null
  createdAt?: Date
  updatedAt?: Date
}

export interface ConnectorRepository {
  list(page: PaginationInput): Promise<{ items: ConnectorRecord[]; total: number }>
  listEnabled(): Promise<ConnectorRecord[]>
  findById(id: string): Promise<ConnectorRecord | null>
  findByProviderId(providerId: string): Promise<ConnectorRecord | null>
  create(input: ConnectorRecordInput): Promise<ConnectorRecord>
  update(id: string, input: Partial<ConnectorRecordInput>): Promise<ConnectorRecord | null>
  delete(id: string): Promise<void>
}

export interface SecretCipher {
  isSealed(value: string): boolean
  seal(plaintext: string, context: string): Promise<string>
  open(envelope: string, context: string): Promise<string>
}

export interface ExternalHttpGateway {
  fetch(request: Request): Promise<Response>
}

export interface AgentAuditEventRecord {
  id: string
  action: string
  result: string
  controllerUserId: string | null
  subjectIssuer: string | null
  subject: string | null
  agentIdentityId: string | null
  hostId: string | null
  resourceId: string | null
  resourceConnectionId: string | null
  accessGrantId: string | null
  scopes: string[] | null
  reasonCode: string | null
  metadata: Record<string, unknown> | null
  occurredAt: Date
}

export interface AgentAuditRepository {
  append(input: AgentAuditEventRecord): Promise<void>
  list(page: PaginationInput): Promise<PaginatedResult<AgentAuditEventRecord>>
}

export interface ExternalResourceAuthorizationRecord {
  resourceId: string
  resourceUrl: string
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string | null
  revocationEndpoint: string
  jwksUri: string
  userInfoEndpoint: string | null
  registrationMode: string
  clientId: string
  encryptedClientSecret: string
  encryptedRegistrationAccessToken: string | null
  metadata: Record<string, unknown>
  status: string
  createdAt: Date
  updatedAt: Date
}

export interface ResourceAccountConnectionRecord {
  id: string
  resourceId: string
  ownerUserId: string | null
  ownerOrganizationId: string | null
  externalSubject: string
  displayName: string
  encryptedTokens: string
  grantedScopes: string[]
  status: string
  credentialExpiresAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ResourceConnectionIntentRecord {
  id: string
  stateHash: string
  resourceId: string
  ownerUserId: string
  ownerOrganizationId: string | null
  scopes: string[]
  encryptedPkceVerifier: string
  returnTo: string
  status: string
  expiresAt: Date
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentAccessRequestRecord {
  id: string
  resourceId: string
  connectionId: string | null
  agentIdentityId: string
  bindingId: string
  scopes: string[]
  reason: string | null
  status: string
  approvalTokenHash: string
  encryptedApprovalToken: string
  grantId: string | null
  expiresAt: Date
  decidedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentAccessGrantRecord {
  id: string
  resourceId: string
  connectionId: string | null
  agentIdentityId: string
  scopes: string[]
  mode: string
  status: string
  grantedByUserId: string
  expiresAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ExternalTokenLeaseRecord {
  id: string
  grantId: string
  requestId: string
  bindingId: string
  encryptedAccessToken: string
  tokenHash: string
  confirmationJkt: string
  scopes: string[]
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}

export interface ExternalResourceRepository {
  upsertAuthorization(input: ExternalResourceAuthorizationRecord): Promise<ExternalResourceAuthorizationRecord>
  findAuthorization(resourceId: string): Promise<ExternalResourceAuthorizationRecord | null>
  createConnection(input: ResourceAccountConnectionRecord): Promise<ResourceAccountConnectionRecord>
  listConnectionsByUser(userId: string): Promise<ResourceAccountConnectionRecord[]>
  listConnectionsByOrganizations(organizationIds: string[]): Promise<ResourceAccountConnectionRecord[]>
  findConnection(id: string): Promise<ResourceAccountConnectionRecord | null>
  updateConnectionTokens(
    id: string,
    input: { encryptedTokens: string; credentialExpiresAt: Date | null; updatedAt: Date },
  ): Promise<ResourceAccountConnectionRecord | null>
  revokeConnection(id: string, now: Date): Promise<boolean>
  createConnectionIntent(input: ResourceConnectionIntentRecord): Promise<ResourceConnectionIntentRecord>
  consumeConnectionIntent(stateHash: string, now: Date): Promise<ResourceConnectionIntentRecord | null>
  createAccessRequest(input: AgentAccessRequestRecord): Promise<AgentAccessRequestRecord>
  findAccessRequest(id: string): Promise<AgentAccessRequestRecord | null>
  findAccessRequestByGrant(grantId: string): Promise<AgentAccessRequestRecord | null>
  findAccessRequestByApprovalTokenHash(tokenHash: string): Promise<AgentAccessRequestRecord | null>
  listPendingAccessRequestsByAgent(agentIdentityId: string, now: Date): Promise<AgentAccessRequestRecord[]>
  listPendingAccessRequests(): Promise<AgentAccessRequestRecord[]>
  decideAccessRequest(
    id: string,
    input: {
      status: 'approved' | 'denied'
      grantId: string | null
      connectionId?: string | null
      decidedAt: Date
      updatedAt: Date
    },
  ): Promise<AgentAccessRequestRecord | null>
  consumeAccessRequest(id: string, now: Date): Promise<boolean>
  listPendingAccessRequestsByConnections(connectionIds: string[]): Promise<AgentAccessRequestRecord[]>
  createGrant(input: AgentAccessGrantRecord): Promise<AgentAccessGrantRecord>
  findGrant(id: string): Promise<AgentAccessGrantRecord | null>
  listActiveGrantsByAgent(agentIdentityId: string): Promise<AgentAccessGrantRecord[]>
  listActiveGrantsByConnection(connectionId: string): Promise<AgentAccessGrantRecord[]>
  revokeGrant(id: string, now: Date): Promise<boolean>
  consumeGrant(id: string, now: Date): Promise<boolean>
  createTokenLease(input: ExternalTokenLeaseRecord): Promise<ExternalTokenLeaseRecord>
  listActiveTokenLeasesByGrant(grantId: string, now: Date): Promise<ExternalTokenLeaseRecord[]>
  listActiveTokenLeasesByBinding(bindingId: string, now: Date): Promise<ExternalTokenLeaseRecord[]>
  revokeTokenLease(id: string, now: Date): Promise<boolean>
}

// --- agents -----------------------------------------------------------------

export interface AgentHostRecord {
  id: string
  name: string | null
  userId: string | null
  defaultCapabilities: string | null
  publicKey: string | null
  kid: string | null
  jwksUrl: string | null
  enrollmentTokenHash: string | null
  enrollmentTokenExpiresAt: Date | null
  status: string
  activatedAt: Date | null
  expiresAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentRecord {
  id: string
  name: string
  userId: string | null
  hostId: string
  status: string
  mode: string
  publicKey: string
  kid: string | null
  jwksUrl: string | null
  lastUsedAt: Date | null
  activatedAt: Date | null
  expiresAt: Date | null
  metadata: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentCapabilityGrantRecord {
  id: string
  agentId: string
  capability: string
  deniedBy: string | null
  grantedBy: string | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
  status: string
  reason: string | null
  constraints: Record<string, unknown> | null
}

export interface ApprovalRequestRecord {
  id: string
  method: string
  agentId: string | null
  hostId: string | null
  userId: string | null
  capabilities: string | null
  status: string
  userCodeHash: string | null
  loginHint: string | null
  bindingMessage: string | null
  clientNotificationToken: string | null
  clientNotificationEndpoint: string | null
  deliveryMode: string | null
  interval: number
  lastPolledAt: Date | null
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface AgentRepository {
  listHosts(page: PaginationInput): Promise<PaginatedResult<AgentHostRecord>>
  listAgents(page: PaginationInput): Promise<PaginatedResult<AgentRecord>>
  listCapabilityGrants(page: PaginationInput): Promise<PaginatedResult<AgentCapabilityGrantRecord>>
  listApprovalRequests(page: PaginationInput): Promise<PaginatedResult<ApprovalRequestRecord>>
  listAgentsForUser(userId: string, page: PaginationInput): Promise<PaginatedResult<AgentRecord>>
  listHostsForAgents(hostIds: string[]): Promise<AgentHostRecord[]>
  listCapabilityGrantsForUser(userId: string): Promise<AgentCapabilityGrantRecord[]>
  decideApproval(input: {
    agentId: string
    userCodeHash: string
    action: 'approve' | 'deny'
    capabilities?: string[]
    userId: string
    now: Date
  }): Promise<'approved' | 'denied'>
  revokeAgentForUser(agentId: string, userId: string): Promise<void>
  revokeCapabilityGrantForUser(grantId: string, userId: string): Promise<void>
  revokeAgent(agentId: string): Promise<void>
  revokeHost(hostId: string): Promise<void>
  revokeCapabilityGrant(grantId: string): Promise<void>
}

export interface AgentIdentityRecord {
  id: string
  issuer: string
  subject: string
  name: string
  ownerUserId: string | null
  ownerOrganizationId: string | null
  status: string
  retiredAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentIdentityBindingRecord {
  id: string
  agentIdentityId: string
  protocolAgentId: string
  hostId: string
  status: string
  boundAt: Date
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentEnrollmentIntentRecord {
  id: string
  agentIdentityId: string | null
  requestedName: string | null
  ownerUserId: string | null
  ownerOrganizationId: string | null
  protocolAgentId: string
  status: string
  createdByUserId: string
  approvedByUserId: string | null
  expiresAt: Date
  approvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentIdentityAggregate {
  identity: AgentIdentityRecord
  bindings: AgentIdentityBindingRecord[]
}

export interface AgentIdentityRepository {
  listPersonal(userId: string): Promise<AgentIdentityAggregate[]>
  listOrganization(organizationId: string): Promise<AgentIdentityAggregate[]>
  listAll(page: PaginationInput): Promise<PaginatedResult<AgentIdentityAggregate>>
  findIdentity(id: string): Promise<AgentIdentityAggregate | null>
  findIntent(id: string): Promise<AgentEnrollmentIntentRecord | null>
  findProtocolAgent(id: string): Promise<AgentRecord | null>
  findBindingByProtocolAgent(id: string): Promise<AgentIdentityBindingRecord | null>
  findActiveByProtocolAgent(id: string): Promise<AgentIdentityAggregate | null>
  createIdentity(input: {
    identity: AgentIdentityRecord
    binding: Omit<AgentIdentityBindingRecord, 'hostId'>
  }): Promise<AgentIdentityAggregate>
  createIntent(input: AgentEnrollmentIntentRecord): Promise<AgentEnrollmentIntentRecord>
  approveIntent(input: {
    intentId: string
    identity: AgentIdentityRecord | null
    binding: Omit<AgentIdentityBindingRecord, 'hostId'>
    approvedByUserId: string
    approvedAt: Date
  }): Promise<AgentIdentityAggregate>
  revokeBinding(identityId: string, protocolAgentId: string, now: Date): Promise<boolean>
  recoverIdentity(identityId: string, now: Date): Promise<boolean>
  retireIdentity(identityId: string, now: Date): Promise<boolean>
}

export interface AgentTokenRepository {
  consumeAgentAuthJti(input: { jtiHash: string; expiresAt: Date; createdAt: Date }): Promise<boolean>
  consumeDpopJti(input: { jtiHash: string; keyThumbprint: string; expiresAt: Date; createdAt: Date }): Promise<boolean>
}

// --- configz ----------------------------------------------------------------

export interface ConfigzSettings {
  passwordEnabled: boolean
  signupEnabled: boolean
  socialLoginEnabled: boolean
  identifierFirst: boolean
  termsUri: string | null
  privacyUri: string | null
  supportEmail: string | null
  metadata: Record<string, unknown> | null
}

export interface ConfigzBranding {
  logoUrl: string | null
  logoAssetUrl: string | null
  faviconUrl: string | null
  faviconAssetUrl: string | null
  primaryColor: string | null
  backgroundColor: string | null
  customCss: string | null
}

export interface ConfigzIdentityProvider {
  slug: string
  providerType: string
  providerId: string
  displayName: string
  icon: string
}

export interface ConfigzApplication {
  id: string
  clientId: string
  redirectUris: string[]
  disabled: boolean
}

export type ConfigzAccountCenter = ConfigzConfigResponse['accountCenter']

export type UpdateConfigzSettingsInput = {
  passwordEnabled?: boolean
  signupEnabled?: boolean
  socialLoginEnabled?: boolean
  identifierFirst?: boolean
  emailOtpEnabled?: boolean
  builtInProviders?: UpdateManagementSignInSettingsRequest['builtInProviders']
  termsUri?: string | null
  privacyUri?: string | null
  supportEmail?: string | null
  copy?: Partial<ConfigzConfigResponse['copy']>
}

export type UpdateConfigzBrandingInput = Partial<ConfigzBranding> & {
  copy?: Partial<ConfigzConfigResponse['copy']>
}

export interface ConfigzRepository {
  getSettings(): Promise<ConfigzSettings | null>
  getBranding(applicationId: string | null): Promise<ConfigzBranding | null>
  getAccountCenterSettings(): Promise<ConfigzAccountCenter | null>
  listEnabledIdentityProviders(): Promise<ConfigzIdentityProvider[]>
  updateSettings(input: UpdateConfigzSettingsInput): Promise<void>
  updateBranding(input: UpdateConfigzBrandingInput): Promise<void>
  updateAccountCenterSettings(input: Partial<ConfigzAccountCenter>): Promise<void>
}

// --- applications -----------------------------------------------------------

export interface ApplicationAggregate {
  id: string
  slug: string
  name: string
  description: string | null
  homepageUrl: string | null
  iconUrl: string | null
  clientId: string
  clientType: ApplicationResponse['clientType']
  public: boolean
  firstParty: boolean
  trusted: boolean
  disabled: boolean
  disabledReason: string | null
  redirectUris: string[]
  postLogoutRedirectUris: string[]
  corsOrigins: string[]
  customData: Record<string, unknown>
  allowedGrantTypes: ApplicationResponse['allowedGrantTypes']
  allowedScopes: ApplicationResponse['allowedScopes']
  requirePkce: boolean
  tokenEndpointAuthMethod: ApplicationResponse['tokenEndpointAuthMethod']
  oidcClaims: ApplicationOidcClaims
  createdAt: Date
  updatedAt: Date
}

export interface ClientSecretRecord {
  id: string
  version: number
  secretHash: string
  secretPrefix: string | null
  status: string
  createdByUserId: string | null
  createdAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
}

export interface ConsentRecord {
  id: string
  scopes: ApplicationResponse['allowedScopes']
  grantedAt: Date
}

export interface ApplicationPaginatedResult<T> {
  items: T[]
  pagination: PaginationMetadata
}

export interface ApplicationRepository {
  create(input: {
    application: Omit<ApplicationAggregate, 'createdAt' | 'updatedAt'>
    clientSecret: Omit<ClientSecretRecord, 'createdAt' | 'expiresAt' | 'revokedAt'> | null
  }): Promise<ApplicationAggregate>
  list(pagination: PaginationQuery): Promise<ApplicationPaginatedResult<ApplicationAggregate>>
  findById(id: string): Promise<ApplicationAggregate | null>
  findByClientId(clientId: string): Promise<ApplicationAggregate | null>
  update(
    id: string,
    patch: Partial<Omit<ApplicationAggregate, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<void>
  delete(id: string): Promise<void>
  listSecrets(
    applicationId: string,
    pagination: PaginationQuery,
  ): Promise<ApplicationPaginatedResult<ClientSecretRecord>>
  rotateSecret(input: {
    applicationId: string
    secret: Omit<ClientSecretRecord, 'createdAt' | 'expiresAt' | 'revokedAt'>
  }): Promise<ClientSecretRecord>
  findConsent(applicationId: string, userId: string): Promise<ConsentRecord | null>
  revokeConsent(consentId: string, userId: string): Promise<boolean>
  createConsent(input: {
    applicationId: string
    clientId: string
    userId: string
    scopes: ApplicationResponse['allowedScopes']
    permissions: string[]
  }): Promise<ConsentRecord>
}

// --- authorization ----------------------------------------------------------

export interface AuthorizationPaginatedResult<T> {
  items: T[]
  pagination: PaginationMetadata
}

export interface RoleAssignmentRecord {
  role: RoleResponse
  scopes: string[]
}

export type OrganizationRecordInput = Omit<OrganizationResponse, 'createdAt' | 'updatedAt'>
export type MemberRecordInput = Omit<MemberResponse, 'createdAt' | 'updatedAt'>
export type InvitationRecordInput = Omit<InvitationResponse, 'createdAt' | 'acceptedAt' | 'revokedAt'>
export type ApiResourceRecordInput = Omit<ApiResourceResponse, 'createdAt' | 'updatedAt'>
export type RoleRecordInput = Omit<RoleResponse, 'createdAt' | 'updatedAt'>
export type RoleAssignmentInput = AssignRoleRequest & { id: string; assignedByUserId: string | null }

export interface RoleAssignmentScope {
  resourceId?: string
  organizationId?: string
  applicationId?: string
}

export interface AuthorizationRepository {
  createOrganization(input: OrganizationRecordInput): Promise<OrganizationResponse>
  listOrganizations(pagination: PaginationQuery): Promise<AuthorizationPaginatedResult<OrganizationResponse>>
  findOrganization(id: string): Promise<OrganizationResponse | null>
  updateOrganization(id: string, patch: UpdateOrganizationRequest): Promise<void>
  deleteOrganization(id: string): Promise<void>
  addMember(organizationId: string, input: MemberRecordInput): Promise<MemberResponse>
  listMembers(
    organizationId: string,
    pagination: PaginationQuery,
  ): Promise<AuthorizationPaginatedResult<MemberResponse>>
  findMember(id: string): Promise<MemberResponse | null>
  findMemberByOrganizationUser(organizationId: string, userId: string): Promise<MemberResponse | null>
  updateMember(id: string, patch: UpdateMemberRequest): Promise<void>
  removeMember(id: string): Promise<void>
  createInvitation(input: InvitationRecordInput): Promise<InvitationResponse>
  listInvitations(
    organizationId: string,
    pagination: PaginationQuery,
  ): Promise<AuthorizationPaginatedResult<InvitationResponse>>
  findInvitation(id: string): Promise<InvitationResponse | null>
  cancelInvitation(id: string): Promise<void>
  createResource(input: ApiResourceRecordInput): Promise<ApiResourceResponse>
  listResources(pagination: PaginationQuery): Promise<AuthorizationPaginatedResult<ApiResourceResponse>>
  findResource(id: string): Promise<ApiResourceResponse | null>
  findResourceByResourceUrl(resourceUrl: string): Promise<ApiResourceResponse | null>
  updateResource(id: string, patch: UpdateApiResourceRequest): Promise<void>
  deleteResource(id: string): Promise<void>
  createRole(input: RoleRecordInput): Promise<RoleResponse>
  listRoles(pagination: PaginationQuery): Promise<AuthorizationPaginatedResult<RoleResponse>>
  findRole(id: string): Promise<RoleResponse | null>
  updateRole(id: string, patch: UpdateRoleRequest): Promise<void>
  deleteRole(id: string): Promise<void>
  listRoleScopes(roleId: string): Promise<string[]>
  replaceRoleScopes(roleId: string, scopes: string[]): Promise<void>
  assignUserRole(input: RoleAssignmentInput): Promise<void>
  assignApplicationRole(input: RoleAssignmentInput): Promise<void>
  assignMemberRole(input: RoleAssignmentInput): Promise<void>
  assignAgentRole(input: RoleAssignmentInput): Promise<void>
  listUserRoleAssignments(userId: string, scope: RoleAssignmentScope): Promise<RoleAssignmentRecord[]>
  listApplicationRoleAssignments(applicationId: string, scope: RoleAssignmentScope): Promise<RoleAssignmentRecord[]>
  listMemberRoleAssignments(memberId: string, scope: RoleAssignmentScope): Promise<RoleAssignmentRecord[]>
  listAgentRoleAssignments(agentIdentityId: string, scope: RoleAssignmentScope): Promise<RoleAssignmentRecord[]>
}

// --- token-exchange ---------------------------------------------------------

export interface OAuthClientRecord {
  clientId: string
  clientSecret: string | null
  disabled: boolean | null
  grantTypes: string | null
  scopes: string | null
}

// A federated credential as managed (never exposes the legacy shared secret).
export interface FederatedCredentialRecord {
  id: string
  applicationId: string
  name: string
  issuer: string
  subject: string
  audienceResourceId: string
  jwksUrl: string | null
  publicKeys: Record<string, unknown>[] | null
  enabled: boolean
  metadata: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

// A federated credential resolved with its owning application's oauth client id
// and its target api-resource audience — all the exchange needs in one shot.
export interface ResolvedFederatedCredential {
  id: string
  applicationId: string
  applicationClientId: string
  name: string
  issuer: string
  subject: string
  audience: string
  jwksUrl: string | null
  publicKeys: Record<string, unknown>[] | null
  enabled: boolean
}

export interface CreateFederatedCredentialInput {
  name: string
  issuer: string
  subject: string
  audienceResourceId: string
  jwksUrl?: string | null
  publicKeys?: Record<string, unknown>[] | null
  metadata?: Record<string, unknown> | null
}

export type UpdateFederatedCredentialInput = Partial<
  Pick<
    CreateFederatedCredentialInput,
    'name' | 'subject' | 'audienceResourceId' | 'jwksUrl' | 'publicKeys' | 'metadata'
  >
> & { enabled?: boolean }

export interface TokenExchangeAccessTokenRecord {
  id: string
  tokenHash: string
  clientId: string
  credentialId: string
  subject: string
  subjectTokenIssuer: string
  audience: string
  scopes: string[]
  claims: Record<string, unknown>
  expiresAt: Date
  createdAt: Date
  revokedAt: Date | null
}

export interface TokenExchangeRefreshTokenRecord {
  id: string
  familyId: string
  tokenHash: string
  clientId: string
  credentialId: string
  subject: string
  subjectTokenIssuer: string
  audience: string
  scopes: string[]
  claims: Record<string, unknown>
  expiresAt: Date
  consumedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

export interface TokenExchangeRepository {
  findClient(clientId: string): Promise<OAuthClientRecord | null>
  // Enabled credentials under the application owning `applicationClientId` that match
  // `issuer`, resolved with their api-resource audience. Subject-pattern matching is
  // done in the usecase.
  findFederatedCredentials(applicationClientId: string, issuer: string): Promise<ResolvedFederatedCredential[]>
  findFederatedCredentialForClient(id: string, clientId: string): Promise<ResolvedFederatedCredential | null>
  listFederatedCredentials(applicationId: string): Promise<FederatedCredentialRecord[]>
  getFederatedCredential(applicationId: string, id: string): Promise<FederatedCredentialRecord | null>
  createFederatedCredential(
    applicationId: string,
    input: CreateFederatedCredentialInput,
  ): Promise<FederatedCredentialRecord>
  updateFederatedCredential(
    applicationId: string,
    id: string,
    input: UpdateFederatedCredentialInput,
  ): Promise<FederatedCredentialRecord | null>
  deleteFederatedCredential(applicationId: string, id: string): Promise<boolean>
  storeAccessToken(input: Omit<TokenExchangeAccessTokenRecord, 'createdAt' | 'revokedAt'>): Promise<void>
  findAccessTokenByHash(tokenHash: string): Promise<TokenExchangeAccessTokenRecord | null>
  storeRefreshToken(
    input: Omit<TokenExchangeRefreshTokenRecord, 'createdAt' | 'consumedAt' | 'revokedAt'>,
  ): Promise<boolean>
  findRefreshTokenByHash(tokenHash: string): Promise<TokenExchangeRefreshTokenRecord | null>
  consumeRefreshToken(id: string, now: Date): Promise<boolean>
  revokeRefreshTokenFamily(familyId: string, now: Date): Promise<void>
}

export interface JwksGateway {
  fetchKeys(jwksUrl: string): Promise<unknown>
}

// --- email ------------------------------------------------------------------

export type EmailTemplate =
  | { type: 'verification'; url: string }
  | { type: 'password-reset'; url: string }
  | { type: 'invitation'; url: string; inviterName: string }
  | { type: 'otp'; otp: string }
  | { type: 'security-notification'; title: string; body: string }

export interface EmailGateway {
  send(email: { to: string; template: EmailTemplate }): Promise<unknown>
}
