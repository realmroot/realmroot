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
  AuthorizedResourceServer,
  InvitationResponse,
  ListAuthorizedResourceServersQuery,
  ListPermissionsQuery,
  MemberResponse,
  OrganizationResponse,
  ResourceScopeRegistry,
  RoleResponse,
  RoleScope,
  UpdateApiResourceRequest,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
} from '@shared/api/authorization'
import type { AuthorizationDetail } from '@shared/api/authorization-details'
import type { ConfigzConfigResponse } from '@shared/api/configz'
import type {
  DeveloperConsoleAccessPolicyResponse,
  EmailServiceSettings,
  OrganizationCreationPolicyResponse,
  ReplaceDeveloperConsoleAccessPolicyRequest,
  ReplaceOrganizationCreationPolicyRequest,
  UpdateManagementSignInSettingsRequest,
} from '@shared/api/management'
import type { OnboardingAdminRequest } from '@shared/api/onboarding'
import type { PaginatedResult, PaginationInput } from '@shared/api/pagination'
import type { AccountProfileLink } from '@shared/api/public-profiles'
import type { SecurityPolicy, UpdateSecurityPolicyInput } from '@shared/api/security'
import type { AdminCreateUserInput, AdminUpdateUserInput, AdminUserListQuery } from '@shared/api/users'
import type {
  ListWebhookEndpointsQuery,
  ListWebhookRequestsQuery,
  WebhookEvent,
  WebhookRequestStatus,
} from '@shared/api/webhooks'

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
  organizationId: string | null
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
  organizationId: string | null
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
  organizationId: string | null
}

export interface WebhookRequestInsert {
  id: string
  endpointId: string
  event: WebhookEvent
  status: WebhookRequestStatus
  attemptCount: number
  httpStatus: number | null
  error: string | null
  requestBody: string
  responseBody: string | null
  nextAttemptAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface WebhookDeliveryAttemptRecord {
  id: string
  requestId: string
  idempotencyKey: string
  sequence: number
  status: string
  httpStatus: number | null
  error: string | null
  responseBody: string | null
  createdAt: Date
  completedAt: Date | null
}

export interface WebhookDeliveryAttemptInsert extends Omit<WebhookDeliveryAttemptRecord, 'status'> {
  status: WebhookRequestStatus
}

export interface WebhookRepository {
  listEndpoints(
    query: ListWebhookEndpointsQuery,
    organizationIds?: string[],
  ): Promise<{ items: WebhookEndpointRecord[]; total: number }>
  listSubscribedEndpoints(event: WebhookEvent, organizationIds: string[]): Promise<WebhookEndpointRecord[]>
  findEndpoint(id: string): Promise<WebhookEndpointRecord | null>
  createEndpoint(input: WebhookEndpointInsert): Promise<WebhookEndpointRecord>
  updateEndpoint(id: string, input: Partial<WebhookEndpointInsert>): Promise<WebhookEndpointRecord | null>
  deleteEndpoint(id: string): Promise<void>
  listRequests(
    query: ListWebhookRequestsQuery,
    organizationIds?: string[],
  ): Promise<{ items: WebhookRequestRecord[]; total: number }>
  findRequest(id: string): Promise<WebhookRequestRecord | null>
  createRequest(input: WebhookRequestInsert): Promise<WebhookRequestRecord>
  updateRequest(id: string, input: Partial<WebhookRequestInsert>): Promise<WebhookRequestRecord | null>
  listAttempts(requestId: string, page: PaginationInput): Promise<PaginatedResult<WebhookDeliveryAttemptRecord>>
  findAttempt(id: string): Promise<WebhookDeliveryAttemptRecord | null>
  findAttemptByIdempotencyKey(requestId: string, idempotencyKey: string): Promise<WebhookDeliveryAttemptRecord | null>
  reserveAttempt(
    input: Omit<WebhookDeliveryAttemptInsert, 'sequence'> & { previousAttemptCount: number },
  ): Promise<{ attempt: WebhookDeliveryAttemptRecord; created: boolean }>
  updateAttempt(id: string, input: Partial<WebhookDeliveryAttemptInsert>): Promise<WebhookDeliveryAttemptRecord | null>
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

export interface UserPublicProfile {
  user: UserProfile
  bio: string | null
  location: string | null
  links: AccountProfileLink[]
  profileUpdatedAt: Date | null
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

export interface UserRepository {
  getUser(userId: string): Promise<UserProfile>
  getPublicProfile(userId: string): Promise<UserPublicProfile>
  findPublicProfileByUsername(username: string): Promise<UserPublicProfile | null>
  listManagedUsers(query: AdminUserListQuery, userIds?: string[]): Promise<PaginatedResult<UserProfile>>
  createManagedUser(input: AdminCreateUserInput): Promise<UserProfile>
  updateManagedUser(userId: string, input: AdminUpdateUserInput): Promise<UserProfile>
  suspendManagedUser(userId: string, reason: string | null, expiresAt: Date | null): Promise<UserProfile>
  restoreManagedUser(userId: string): Promise<UserProfile>
  deleteManagedUser(userId: string): Promise<void>
  updateProfile(userId: string, input: AccountProfileUpdateInput): Promise<UserProfile>
  assertAccountAvatarReference(userId: string, avatarAssetId: string | null | undefined): Promise<void>
  assertAdminAvatarReference(avatarAssetId: string | null | undefined): Promise<void>
  listLinkedAccounts(userId: string, page: PaginationInput): Promise<PaginatedResult<LinkedAccount>>
  listSessions(userId: string, page: PaginationInput): Promise<PaginatedResult<UserSessionDevice>>
  getSessionToken(userId: string, sessionId: string): Promise<string>
  deleteSessions(userId: string, sessionId?: string): Promise<UserSessionDevice[]>
  createPasswordResetRequest?(input: PasswordResetRequest): Promise<PasswordResetRequest>
  findPasswordResetRequest?(userId: string, requestId: string): Promise<PasswordResetRequest | null>
}

export interface PasswordResetRequest {
  id: string
  userId: string
  status: 'accepted'
  createdAt: Date
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
  authenticationEnabled: boolean
  clientId: string | null
  clientSecret: string | null
  clientSecretContext: string | null
  issuer: string | null
  authorizationEndpoint: string | null
  tokenEndpoint: string | null
  userInfoEndpoint: string | null
  jwksEndpoint: string | null
  registrationEndpoint: string | null
  revocationEndpoint: string | null
  registrationMode: string | null
  registrationClientUri?: string | null
  registrationAccessToken: string | null
  registrationAccessTokenContext: string | null
  registeredScopes?: string[] | null
  clientGeneration?: number
  retiredClientGenerations?: RetiredOAuthClientGeneration[] | null
  scopes: string[] | null
  attributeMapping: Record<string, string> | null
  providerMetadata: Record<string, unknown> | null
  resourceAuthorizationEnabled: boolean
  resourceClientId: string | null
  resourceClientSecret: string | null
  resourceClientSecretContext: string | null
  resourceIssuer: string | null
  resourceAuthorizationEndpoint: string | null
  resourceTokenEndpoint: string | null
  resourceUserInfoEndpoint: string | null
  resourceJwksEndpoint: string | null
  resourceRegistrationEndpoint: string | null
  resourceRevocationEndpoint: string | null
  resourceRegistrationMode: string | null
  resourceRegistrationClientUri: string | null
  resourceRegistrationAccessToken: string | null
  resourceRegistrationAccessTokenContext: string | null
  resourceRegisteredScopes: string[] | null
  resourceClientGeneration: number
  resourceRetiredClientGenerations: RetiredOAuthClientGeneration[] | null
  resourceProviderMetadata: Record<string, unknown> | null
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
  authenticationEnabled?: boolean
  clientId?: string | null
  clientSecret?: string | null
  clientSecretContext?: string | null
  issuer?: string | null
  authorizationEndpoint?: string | null
  tokenEndpoint?: string | null
  userInfoEndpoint?: string | null
  jwksEndpoint?: string | null
  registrationEndpoint?: string | null
  revocationEndpoint?: string | null
  registrationMode?: string | null
  registrationClientUri?: string | null
  registrationAccessToken?: string | null
  registrationAccessTokenContext?: string | null
  registeredScopes?: string[] | null
  clientGeneration?: number
  retiredClientGenerations?: RetiredOAuthClientGeneration[] | null
  scopes?: string[] | null
  attributeMapping?: Record<string, string> | null
  providerMetadata?: Record<string, unknown> | null
  resourceAuthorizationEnabled?: boolean
  resourceClientId?: string | null
  resourceClientSecret?: string | null
  resourceClientSecretContext?: string | null
  resourceIssuer?: string | null
  resourceAuthorizationEndpoint?: string | null
  resourceTokenEndpoint?: string | null
  resourceUserInfoEndpoint?: string | null
  resourceJwksEndpoint?: string | null
  resourceRegistrationEndpoint?: string | null
  resourceRevocationEndpoint?: string | null
  resourceRegistrationMode?: string | null
  resourceRegistrationClientUri?: string | null
  resourceRegistrationAccessToken?: string | null
  resourceRegistrationAccessTokenContext?: string | null
  resourceRegisteredScopes?: string[] | null
  resourceClientGeneration?: number
  resourceRetiredClientGenerations?: RetiredOAuthClientGeneration[] | null
  resourceProviderMetadata?: Record<string, unknown> | null
  createdAt?: Date
  updatedAt?: Date
}

export interface RetiredOAuthClientGeneration {
  generation: number
  clientId: string
  encryptedClientSecret: string
  clientSecretContext: string
  registrationClientUri: string | null
  encryptedRegistrationAccessToken: string | null
  registrationAccessTokenContext: string | null
  registeredScopes: string[]
}

export interface ConnectorRepository {
  list(page: PaginationInput): Promise<{ items: ConnectorRecord[]; total: number }>
  listEnabled(): Promise<ConnectorRecord[]>
  findById(id: string): Promise<ConnectorRecord | null>
  findByProviderId(providerId: string): Promise<ConnectorRecord | null>
  countResourceReferences(id: string): Promise<number>
  create(input: ConnectorRecordInput): Promise<ConnectorRecord>
  update(id: string, input: Partial<ConnectorRecordInput>): Promise<ConnectorRecord | null>
  rotateClientGeneration(
    id: string,
    expectedGeneration: number,
    input: Partial<ConnectorRecordInput>,
  ): Promise<ConnectorRecord | null>
  rotateResourceClientGeneration(
    id: string,
    expectedGeneration: number,
    input: Partial<ConnectorRecordInput>,
  ): Promise<ConnectorRecord | null>
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
  realmOwned: boolean
  ownerUserId: string | null
  ownerOrganizationId: string | null
  controllerUserId: string | null
  subjectIssuer: string | null
  subject: string | null
  agentIdentityId: string | null
  hostId: string | null
  resourceId: string | null
  resourceConnectionId: string | null
  accessRequestId: string | null
  scopes: string[] | null
  reasonCode: string | null
  metadata: Record<string, unknown> | null
  occurredAt: Date
}

export interface AgentAuditRepository {
  append(input: AgentAuditEventRecord): Promise<void>
  list(
    page: PaginationInput,
    filter?: {
      actions?: string[]
      action?: string
      result?: 'allowed' | 'denied' | 'pending'
      search?: string
      agentIdentityId?: string
      ownerUserId?: string
      ownerOrganizationIds?: string[]
    },
  ): Promise<PaginatedResult<AgentAuditEventRecord>>
  summarizeByDay(
    since: Date,
    filter: { agentIdentityId?: string; ownerUserId?: string; ownerOrganizationIds?: string[] },
  ): Promise<Array<{ date: string; count: number }>>
}

export interface ExternalResourceAuthorizationRecord {
  resourceId: string
  connectorId: string
  resourceUrl: string
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  pushedAuthorizationRequestEndpoint: string | null
  authorizationDetailsTypesSupported: string[]
  authorizationDetailsCatalogEndpoint: string | null
  authorizationDetailsCatalogScope: string | null
  registrationEndpoint: string | null
  revocationEndpoint: string
  jwksUri: string | null
  userInfoEndpoint: string | null
  tokenEndpointAuthentication: 'basic' | 'post'
  revocationAuthentication: 'basic' | 'post' | 'none'
  authorizationDetailsMode: 'provider' | 'connection'
  revokeAccessToken: boolean
  registrationMode: string
  clientId: string
  clientGeneration?: number
  encryptedClientSecret: string
  encryptedRegistrationAccessToken: string | null
  metadata: Record<string, unknown>
  status: string
  createdAt: Date
  updatedAt: Date
}

export interface ProviderConnectionRecord {
  id: string
  connectorId: string
  ownerUserId: string | null
  ownerOrganizationId: string | null
  authenticationAccountId: string | null
  externalSubject: string
  displayName: string
  status: 'active' | 'suspended' | 'revoked'
  createdAt: Date
  updatedAt: Date
}

export interface ProviderConnectorSummary {
  id: string
  slug: string
  providerType: string
  providerId: string
  displayName: string
  enabled: boolean
  authenticationEnabled: boolean
  resourceAuthorizationEnabled: boolean
}

export interface ProviderConnectionProjection extends ProviderConnectionRecord {
  connector: ProviderConnectorSummary
  resourceAuthorizationCount: number
  resourceNames: string[]
}

export interface ProviderResourceAuthorizationRecord {
  id: string
  providerConnectionId: string
  resourceId: string
  ownerUserId: string | null
  ownerOrganizationId: string | null
  externalSubject: string
  displayName: string
  credentials: ProviderCredentialRecord[]
  grantedScopes: string[]
  authorizationDetails: AuthorizationDetail[]
  status: string
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ProviderCredentialRecord {
  id: string
  providerResourceAuthorizationId: string
  encryptedTokens: string
  grantedScopes: string[]
  authorizationDetails: AuthorizationDetail[]
  clientGeneration: number
  credentialVersion: number
  refreshClaimId: string | null
  refreshClaimExpiresAt: Date | null
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
  ownerUserId: string | null
  ownerOrganizationId: string | null
  initiatedByUserId: string
  scopes: string[]
  authorizationDetails: AuthorizationDetail[]
  encryptedPkceVerifier: string
  clientGeneration?: number
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
  authorizationDetails: AuthorizationDetail[]
  reason: string | null
  status: string
  approvalTokenHash: string
  encryptedApprovalToken: string
  approvedEntitlements: Array<{ scope: string; entitlementId: string }>
  expiresAt: Date
  decidedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type ResourceScopeEntitlementMode = 'persistent' | 'until' | 'once'
export type ResourceScopeEntitlementEndReason = 'revoked' | 'consumed' | 'expired' | 'merged'

export interface ResourceScopeEntitlementRecord {
  id: string
  userId: string | null
  applicationId: string | null
  agentIdentityId: string | null
  organizationId: string | null
  resourceServerId: string
  connectionId: string | null
  authorizationDetails: AuthorizationDetail[]
  authorizationContextHash: string
  scope: string
  mode: ResourceScopeEntitlementMode
  grantedByUserId: string | null
  grantedByAgentIdentityId: string | null
  sourceAccessRequestId: string | null
  expiresAt: Date | null
  endedAt: Date | null
  endReason: ResourceScopeEntitlementEndReason | null
  createdAt: Date
  updatedAt: Date
}

export type PermissionSubject =
  | { type: 'user'; id: string }
  | { type: 'application'; id: string }
  | { type: 'agent'; id: string }

export type AuthorizedResourceServerRecord = AuthorizedResourceServer

export interface AgentGovernanceResourceRecord {
  id: string
  identifier: string
  name: string
}

export interface AgentPermissionProjection {
  entitlement: ResourceScopeEntitlementRecord
  resource: AgentGovernanceResourceRecord
}

export interface AgentAccessSummary {
  pendingRequestCount: number
  activeResourceCount: number
  activeScopeCount: number
}

export interface AgentAuthorityInventoryScope {
  ownerOrganizationIds?: string[]
  ownerUserId?: string
}

export interface ExternalTokenLeaseRecord {
  id: string
  entitlementIds: string[]
  requestId: string
  bindingId: string
  encryptedAccessToken: string
  tokenHash: string
  confirmationJkt: string
  scopes: string[]
  authorizationDetails: AuthorizationDetail[]
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}

export interface TokenLeaseAuthorizationBoundary {
  agentIdentityId: string
  resourceServerId: string
  connectionId: string | null
  authorizationContextHash: string
  scopes: string[]
}

export interface ExternalResourceRepository {
  upsertProviderConnection(input: ProviderConnectionRecord): Promise<ProviderConnectionRecord>
  findProviderConnectionByOwnerConnector(input: {
    connectorId: string
    ownerUserId: string | null
    ownerOrganizationId: string | null
  }): Promise<ProviderConnectionRecord | null>
  findActiveUserProviderConnectionByProviderSubject(input: {
    providerId: string
    externalSubject: string
  }): Promise<ProviderConnectionRecord | null>
  findProviderConnection(id: string): Promise<ProviderConnectionRecord | null>
  listProviderConnectionsByUser(userId: string): Promise<ProviderConnectionProjection[]>
  revokeProviderConnection(id: string, ownerUserId: string, now: Date): Promise<boolean>
  createResourceAuthorization(
    input: Omit<
      ProviderResourceAuthorizationRecord,
      | 'ownerUserId'
      | 'ownerOrganizationId'
      | 'externalSubject'
      | 'displayName'
      | 'grantedScopes'
      | 'authorizationDetails'
    >,
  ): Promise<ProviderResourceAuthorizationRecord | null>
  findConnectionByOwnerResource(input: {
    resourceId: string
    ownerUserId: string | null
    ownerOrganizationId: string | null
  }): Promise<ProviderResourceAuthorizationRecord | null>
  findConnectionByProviderResource(input: {
    providerConnectionId: string
    resourceId: string
  }): Promise<ProviderResourceAuthorizationRecord | null>
  upsertProviderCredential(
    providerResourceAuthorizationId: string,
    input: {
      id: string
      encryptedTokens: string
      grantedScopes: string[]
      authorizationDetails: AuthorizationDetail[]
      clientGeneration: number
      credentialVersion: number
      refreshClaimId: null
      refreshClaimExpiresAt: null
      status: 'active'
      credentialExpiresAt: Date | null
      revokedAt: null
      createdAt: Date
      updatedAt: Date
    },
  ): Promise<ProviderResourceAuthorizationRecord | null>
  listConnectionsByUser(userId: string): Promise<ProviderResourceAuthorizationRecord[]>
  listConnectionsByOrganizations(organizationIds: string[]): Promise<ProviderResourceAuthorizationRecord[]>
  findConnection(id: string): Promise<ProviderResourceAuthorizationRecord | null>
  updateProviderCredentialTokens(
    id: string,
    input: { encryptedTokens: string; credentialExpiresAt: Date | null; updatedAt: Date },
  ): Promise<ProviderCredentialRecord | null>
  claimProviderCredentialRefresh(input: {
    id: string
    expectedVersion: number
    claimId: string
    now: Date
    claimExpiresAt: Date
  }): Promise<boolean>
  completeProviderCredentialRefresh(
    id: string,
    input: {
      expectedVersion: number
      claimId: string
      encryptedTokens: string
      credentialExpiresAt: Date | null
      updatedAt: Date
    },
  ): Promise<ProviderCredentialRecord | null>
  releaseProviderCredentialRefresh(id: string, expectedVersion: number, claimId: string, now: Date): Promise<boolean>
  revokeProviderCredential(id: string, now: Date): Promise<boolean>
  revokeConnection(id: string, now: Date): Promise<boolean>
  revokeResourceAuthorizationsByConnector(connectorId: string, now: Date): Promise<number>
  createConnectionIntent(input: ResourceConnectionIntentRecord): Promise<ResourceConnectionIntentRecord | null>
  consumeConnectionIntent(stateHash: string, now: Date): Promise<ResourceConnectionIntentRecord | null>
  createAccessRequest(input: AgentAccessRequestRecord): Promise<AgentAccessRequestRecord | null>
  createAccessRequestWithAudit(
    input: AgentAccessRequestRecord,
    audit: AgentAuditEventRecord,
  ): Promise<AgentAccessRequestRecord | null>
  findAccessRequest(id: string): Promise<AgentAccessRequestRecord | null>
  findAccessRequestByApprovalTokenHash(tokenHash: string): Promise<AgentAccessRequestRecord | null>
  listPendingAccessRequestsByAgent(agentIdentityId: string, now: Date): Promise<AgentAccessRequestRecord[]>
  listPendingAccessRequests(now: Date): Promise<AgentAccessRequestRecord[]>
  decideAccessRequest(
    id: string,
    input: {
      status: 'approved' | 'denied'
      approvedEntitlements: Array<{ scope: string; entitlementId: string }>
      connectionId?: string | null
      decidedAt: Date
      updatedAt: Date
    },
  ): Promise<AgentAccessRequestRecord | null>
  decideAccessRequestWithAudit(
    id: string,
    input: {
      status: 'approved' | 'denied'
      approvedEntitlements: Array<{ scope: string; entitlementId: string }>
      connectionId?: string | null
      decidedAt: Date
      updatedAt: Date
    },
    audit: AgentAuditEventRecord,
  ): Promise<AgentAccessRequestRecord | null>
  consumeAccessRequest(id: string, now: Date): Promise<boolean>
  listPendingAccessRequestsByConnections(connectionIds: string[]): Promise<AgentAccessRequestRecord[]>
  approveAccessRequestWithEntitlements(
    entitlements: ResourceScopeEntitlementRecord[],
    entitlementUpdates: Array<{
      id: string
      mode: ResourceScopeEntitlementMode
      expiresAt: Date | null
      authorizationContextHash: string
      updatedAt: Date
    }>,
    requestId: string,
    decision: {
      status: 'approved'
      approvedEntitlements: Array<{ scope: string; entitlementId: string }>
      connectionId: string | null
      authorizationDetails: AuthorizationDetail[]
      decidedAt: Date
      updatedAt: Date
    },
    audit: AgentAuditEventRecord,
  ): Promise<
    | { entitlements: ResourceScopeEntitlementRecord[]; request: AgentAccessRequestRecord }
    | 'resource_unavailable'
    | 'request_changed'
  >
  findEntitlement(id: string): Promise<ResourceScopeEntitlementRecord | null>
  findEntitlements(ids: string[]): Promise<ResourceScopeEntitlementRecord[]>
  listActiveEntitlementsByAgent(agentIdentityId: string, now: Date): Promise<ResourceScopeEntitlementRecord[]>
  listAgentPermissions(
    query: PaginationInput & {
      agentId?: string
      organizationId?: string
      resourceServerId?: string
      status?: 'active' | 'inactive'
    },
    scope?: AgentAuthorityInventoryScope,
  ): Promise<PaginatedResult<AgentPermissionProjection>>
  summarizeAgentAccess(agentIdentityIds: string[], now: Date): Promise<Map<string, AgentAccessSummary>>
  listActiveEntitlementsByConnection(connectionId: string, now: Date): Promise<ResourceScopeEntitlementRecord[]>
  endEntitlement(id: string, reason: ResourceScopeEntitlementEndReason, now: Date): Promise<boolean>
  endEntitlementWithAudit(
    id: string,
    reason: ResourceScopeEntitlementEndReason,
    tokenLeaseIds: string[],
    now: Date,
    audit: AgentAuditEventRecord,
  ): Promise<boolean>
  createTokenLease(input: ExternalTokenLeaseRecord): Promise<ExternalTokenLeaseRecord | null>
  issueTokenLeaseWithAudit(
    input: ExternalTokenLeaseRecord,
    boundary: TokenLeaseAuthorizationBoundary,
    consumeEntitlementIds: string[],
    now: Date,
    audit: AgentAuditEventRecord,
  ): Promise<ExternalTokenLeaseRecord | null>
  listActiveTokenLeasesByEntitlement(entitlementId: string, now: Date): Promise<ExternalTokenLeaseRecord[]>
  listActiveTokenLeasesByBinding(bindingId: string, now: Date): Promise<ExternalTokenLeaseRecord[]>
  findActiveTokenLeaseByTokenHash(tokenHash: string, now: Date): Promise<ExternalTokenLeaseRecord | null>
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
  findApprovalRequest(id: string): Promise<ApprovalRequestRecord | null>
  createApprovalRequest(record: ApprovalRequestRecord): Promise<ApprovalRequestRecord>
  listAgentsForUser(userId: string, page: PaginationInput): Promise<PaginatedResult<AgentRecord>>
  listHostsForAgents(hostIds: string[]): Promise<AgentHostRecord[]>
  listCapabilityGrantsForUser(userId: string): Promise<AgentCapabilityGrantRecord[]>
  listCapabilityGrantsForAgent(agentId: string): Promise<AgentCapabilityGrantRecord[]>
  findPendingApprovalPreview(input: {
    agentId: string
    userCodeHash: string
    now: Date
  }): Promise<{ request: ApprovalRequestRecord; agent: AgentRecord; host: AgentHostRecord } | null>
  decideApproval(
    input: {
      agentId: string
      userCodeHash: string
      action: 'approve' | 'deny'
      capabilities?: string[]
      userId: string
      now: Date
    },
    audit: AgentAuditEventRecord,
  ): Promise<'approved' | 'denied'>
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
  username: string | null
  name: string
  runtime?: string | null
  ownerUserId: string | null
  ownerOrganizationId: string | null
  status: 'active' | 'inactive'
  deletedAt: Date | null
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
  requestedUsername?: string | null
  requestedRuntime?: string | null
  ownerUserId: string | null
  ownerOrganizationId: string | null
  protocolAgentId: string
  idempotencyKey: string | null
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

export interface AgentApplicationCreationRecord {
  id: string
  applicationId: string
  actorUserId: string
  idempotencyKey: string
  requestFingerprint: string
  agentIdentityId: string
  createdAt: Date
}

export interface AgentIdentityRepository {
  listPersonal(userId: string): Promise<AgentIdentityAggregate[]>
  listOrganization(organizationId: string): Promise<AgentIdentityAggregate[]>
  listOwned(
    scope: AgentAuthorityInventoryScope,
    page: PaginationInput,
  ): Promise<PaginatedResult<AgentIdentityAggregate>>
  listAll(page: PaginationInput): Promise<PaginatedResult<AgentIdentityAggregate>>
  findIdentity(id: string): Promise<AgentIdentityAggregate | null>
  findByIssuerSubject(issuer: string, subject: string): Promise<AgentIdentityRecord | null>
  findByIssuerUsername(issuer: string, username: string): Promise<AgentIdentityRecord | null>
  findByUsername(username: string): Promise<AgentIdentityRecord | null>
  findIntent(id: string): Promise<AgentEnrollmentIntentRecord | null>
  findIntentByIdempotencyKey(
    protocolAgentId: string,
    idempotencyKey: string,
  ): Promise<AgentEnrollmentIntentRecord | null>
  findLatestApprovedIdentityIntent(protocolAgentId: string): Promise<AgentEnrollmentIntentRecord | null>
  findProtocolAgent(id: string): Promise<AgentRecord | null>
  findBindingByProtocolAgent(id: string): Promise<AgentIdentityBindingRecord | null>
  findActiveBindingByProtocolAgent(
    id: string,
  ): Promise<{ identity: AgentIdentityRecord; binding: AgentIdentityBindingRecord } | null>
  findActiveByProtocolAgent(id: string): Promise<AgentIdentityAggregate | null>
  findApplicationCreation(
    applicationId: string,
    actorUserId: string,
    idempotencyKey: string,
  ): Promise<{ reservation: AgentApplicationCreationRecord; identity: AgentIdentityAggregate } | null>
  createIdentity(input: {
    identity: AgentIdentityRecord
    binding: Omit<AgentIdentityBindingRecord, 'hostId'>
  }): Promise<AgentIdentityAggregate>
  createAgentWithInstallation(input: {
    host: AgentHostRecord
    protocolAgent: AgentRecord
    identity: AgentIdentityRecord
    binding: Omit<AgentIdentityBindingRecord, 'hostId'>
    audit: AgentAuditEventRecord
    reservation: AgentApplicationCreationRecord
  }): Promise<{
    identity: AgentIdentityAggregate
    reservation: AgentApplicationCreationRecord
    created: boolean
  }>
  claimIdentityProfile(
    identityId: string,
    input: { username: string; name: string; runtime: string; updatedAt: Date },
  ): Promise<AgentIdentityAggregate | null>
  createIntent(input: AgentEnrollmentIntentRecord): Promise<AgentEnrollmentIntentRecord>
  createIntentIdempotently(
    input: AgentEnrollmentIntentRecord & { idempotencyKey: string },
  ): Promise<{ intent: AgentEnrollmentIntentRecord; created: boolean }>
  approveIntent(input: {
    intentId: string
    identity: AgentIdentityRecord | null
    binding: Omit<AgentIdentityBindingRecord, 'hostId'>
    approvedByUserId: string
    approvedAt: Date
  }): Promise<AgentIdentityAggregate>
  revokeBinding(identityId: string, protocolAgentId: string, now: Date): Promise<boolean>
  deactivateIdentity(identityId: string, now: Date, revokeBindings: boolean): Promise<boolean>
  activateIdentity(identityId: string, now: Date): Promise<boolean>
  deleteIdentity(identityId: string, now: Date): Promise<boolean>
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
  usernameEnabled?: boolean
  identifierFirst?: boolean
  emailOtpEnabled?: boolean
  builtInProviders?: UpdateManagementSignInSettingsRequest['builtInProviders']
  termsUri?: string | null
  privacyUri?: string | null
  supportUri?: string | null
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
  getOrganizationCreationPolicy(): Promise<OrganizationCreationPolicyResponse>
  getDeveloperConsoleAccessPolicy(): Promise<DeveloperConsoleAccessPolicyResponse>
  getEmailSettings(): Promise<EmailServiceSettings | null>
  listEnabledIdentityProviders(): Promise<ConfigzIdentityProvider[]>
  updateSettings(input: UpdateConfigzSettingsInput): Promise<void>
  updateBranding(input: UpdateConfigzBrandingInput): Promise<void>
  updateAccountCenterSettings(input: Partial<ConfigzAccountCenter>): Promise<void>
  updateOrganizationCreationPolicy(input: ReplaceOrganizationCreationPolicyRequest): Promise<void>
  updateDeveloperConsoleAccessPolicy(input: ReplaceDeveloperConsoleAccessPolicyRequest): Promise<void>
  updateEmailSettings(input: EmailServiceSettings): Promise<void>
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
  visibility: ApplicationResponse['visibility']
  consentRequired: boolean
  disabled: boolean
  disabledReason: string | null
  ownerOrganizationId: string
  redirectUris: string[]
  postLogoutRedirectUris: string[]
  corsOrigins: string[]
  customData: Record<string, unknown>
  allowedGrantTypes: ApplicationResponse['allowedGrantTypes']
  oidcScopes: ApplicationResponse['oidcScopes']
  resourceScopes: ApplicationResponse['resourceScopes']
  tokenExchangePolicies: ApplicationResponse['tokenExchangePolicies']
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
  resourceServerId: string | null
  scopes: string[]
  authorizationSource: 'user_consent' | 'platform_policy'
  grantedAt: Date
}

export interface ApplicationAuthorizationRecord {
  id: string
  applicationId: string
  applicationName: string
  applicationSlug: string
  userId: string
  userDisplayName: string
  userEmail: string
  resourceServerId: string | null
  scopes: string[]
  authorizationSource: 'user_consent' | 'platform_policy'
  grantedAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
}

export interface ApplicationPaginatedResult<T> {
  items: T[]
  pagination: PaginationMetadata
}

export type ApplicationUpdateResult = 'updated' | 'application_not_found' | 'resource_inactive'

export interface ApplicationRepository {
  create(input: {
    application: Omit<ApplicationAggregate, 'createdAt' | 'updatedAt'>
    clientSecret: Omit<ClientSecretRecord, 'createdAt' | 'expiresAt' | 'revokedAt'> | null
  }): Promise<ApplicationAggregate>
  list(
    pagination: PaginationQuery,
    ownerOrganizationIds?: string[],
  ): Promise<ApplicationPaginatedResult<ApplicationAggregate>>
  findById(id: string): Promise<ApplicationAggregate | null>
  findByClientId(clientId: string): Promise<ApplicationAggregate | null>
  update(
    id: string,
    patch: Partial<Omit<ApplicationAggregate, 'id' | 'clientId' | 'ownerOrganizationId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<ApplicationUpdateResult>
  delete(id: string): Promise<void>
  listSecrets(
    applicationId: string,
    pagination: PaginationQuery,
  ): Promise<ApplicationPaginatedResult<ClientSecretRecord>>
  rotateSecret(input: {
    applicationId: string
    secret: Omit<ClientSecretRecord, 'createdAt' | 'expiresAt' | 'revokedAt'>
  }): Promise<ClientSecretRecord>
  listAuthorizations(
    query: PaginationQuery & { applicationId?: string; userId?: string; status?: 'active' | 'expired' | 'revoked' },
    ownerOrganizationIds?: string[],
  ): Promise<ApplicationPaginatedResult<ApplicationAuthorizationRecord>>
  findAuthorization(authorizationId: string): Promise<ApplicationAuthorizationRecord | null>
  revokeAuthorization(authorizationId: string): Promise<boolean>
  findConsent(applicationId: string, userId: string, resourceServerId: string | null): Promise<ConsentRecord | null>
  revokeConsent(consentId: string, userId: string): Promise<boolean>
  createConsent(input: {
    applicationId: string
    clientId: string
    userId: string
    resourceServerId: string | null
    scopes: string[]
  }): Promise<ConsentRecord>
  recordPolicyAuthorization(input: {
    applicationId: string
    userId: string
    resourceServerId: string | null
    scopes: string[]
  }): Promise<ConsentRecord>
}

// --- authorization ----------------------------------------------------------

export interface AuthorizationPaginatedResult<T> {
  items: T[]
  pagination: PaginationMetadata
}

export type OrganizationRecordInput = Omit<OrganizationResponse, 'createdAt' | 'updatedAt'>
export type MemberRecordInput = Omit<MemberResponse, 'createdAt' | 'updatedAt'>
export type InvitationRecordInput = Omit<InvitationResponse, 'createdAt' | 'acceptedAt' | 'revokedAt'>
export type ApiResourceRecordInput = Omit<ApiResourceResponse, 'createdAt' | 'updatedAt'>
export type OrganizationRoleRecordInput = Omit<RoleResponse, 'predefined' | 'createdAt' | 'updatedAt'>
export type TeamRecord = {
  id: string
  name: string
  organizationId: string
  createdAt: string
  updatedAt: string
}
export type TeamMemberRecord = {
  id: string
  teamId: string
  userId: string
  createdAt: string
}

export interface AuthorizationRepository {
  createOrganization(
    input: OrganizationRecordInput,
    owner: Omit<MemberRecordInput, 'organizationId'>,
  ): Promise<OrganizationResponse>
  listOrganizations(
    pagination: PaginationQuery,
    organizationIds?: string[],
  ): Promise<AuthorizationPaginatedResult<OrganizationResponse>>
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
  listUserMemberships(userId: string): Promise<MemberResponse[]>
  findTeam(id: string): Promise<TeamRecord | null>
  listTeamMembers(teamId: string, pagination: PaginationQuery): Promise<AuthorizationPaginatedResult<TeamMemberRecord>>
  listTeamNamesForUser(organizationId: string, userId: string): Promise<string[]>
  listMemberUserIds(organizationIds: string[]): Promise<string[]>
  countMembersByRole(organizationId: string, role: string): Promise<number>
  hasPendingInvitation(email: string, now: Date): Promise<boolean>
  updateMember(id: string, patch: UpdateMemberRequest): Promise<void>
  replaceMemberRoles(
    organizationId: string,
    memberId: string,
    roles: string[],
    expectedUpdatedAt: string,
    audit: AgentAuditEventRecord,
  ): Promise<boolean>
  removeMember(
    organizationId: string,
    memberId: string,
    expectedUpdatedAt: string,
    audit: AgentAuditEventRecord,
  ): Promise<boolean>
  createInvitation(input: InvitationRecordInput): Promise<InvitationResponse>
  listInvitations(
    organizationId: string,
    pagination: PaginationQuery,
  ): Promise<AuthorizationPaginatedResult<InvitationResponse>>
  findInvitation(id: string): Promise<InvitationResponse | null>
  cancelInvitation(id: string): Promise<void>
  createResource(input: ApiResourceRecordInput): Promise<ApiResourceResponse>
  listResources(
    pagination: PaginationQuery,
    ownerOrganizationIds?: string[],
  ): Promise<AuthorizationPaginatedResult<ApiResourceResponse>>
  listEnabledResources(): Promise<ApiResourceResponse[]>
  findResources(ids: string[]): Promise<ApiResourceResponse[]>
  findResource(id: string): Promise<ApiResourceResponse | null>
  findResourceByResourceUrl(resourceUrl: string): Promise<ApiResourceResponse | null>
  updateResource(
    id: string,
    patch: UpdateApiResourceRequest & { name?: string; description?: string | null },
  ): Promise<boolean>
  replaceResourceDiscovery(
    id: string,
    discovery: { name: string; description: string | null; scopeRegistry: ResourceScopeRegistry },
  ): Promise<boolean>
  createScopeEntitlement(input: ResourceScopeEntitlementRecord, now: Date): Promise<ResourceScopeEntitlementRecord>
  findScopeEntitlement(id: string): Promise<ResourceScopeEntitlementRecord | null>
  listUserPermissions(
    userId: string,
    query: ListPermissionsQuery,
    ownerOrganizationIds?: string[],
  ): Promise<AuthorizationPaginatedResult<ResourceScopeEntitlementRecord>>
  listActiveUserScopeEntitlements(
    userId: string,
    resourceServerId: string,
    now: Date,
  ): Promise<ResourceScopeEntitlementRecord[]>
  listApplicationPermissions(
    applicationId: string,
    query: ListPermissionsQuery,
  ): Promise<AuthorizationPaginatedResult<ResourceScopeEntitlementRecord>>
  listAuthorizedResourceServers(
    subject: PermissionSubject,
    query: ListAuthorizedResourceServersQuery,
    now: Date,
    ownerOrganizationIds?: string[],
  ): Promise<AuthorizationPaginatedResult<AuthorizedResourceServerRecord>>
  listActiveApplicationScopeEntitlements(
    applicationId: string,
    resourceServerId: string,
    now: Date,
  ): Promise<ResourceScopeEntitlementRecord[]>
  endScopeEntitlement(id: string, reason: ResourceScopeEntitlementEndReason, now: Date): Promise<boolean>
  deleteResource(id: string, now: Date, audit: AgentAuditEventRecord): Promise<boolean>
  createOrganizationRole(
    organizationId: string,
    input: OrganizationRoleRecordInput,
    permission: Record<string, string[]>,
    audit: AgentAuditEventRecord,
  ): Promise<RoleResponse>
  listOrganizationRoles(organizationId: string): Promise<RoleResponse[]>
  findOrganizationRole(organizationId: string, roleKey: string): Promise<RoleResponse | null>
  updateOrganizationRole(
    organizationId: string,
    roleKey: string,
    patch: UpdateRoleRequest,
    permission: Record<string, string[]> | undefined,
    expectedUpdatedAt: string,
    audit: AgentAuditEventRecord,
  ): Promise<boolean>
  deleteOrganizationRole(
    organizationId: string,
    roleKey: string,
    expectedUpdatedAt: string,
    audit: AgentAuditEventRecord,
  ): Promise<'deleted' | 'not_found' | 'assigned'>
  listOrganizationRoleScopes(organizationId: string): Promise<Map<string, RoleScope[]>>
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
  ownerOrganizationId: string
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
  parentId: string | null
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
  rotateRefreshToken(input: {
    refreshToken: Omit<TokenExchangeRefreshTokenRecord, 'createdAt' | 'consumedAt' | 'revokedAt'>
    accessToken: Omit<TokenExchangeAccessTokenRecord, 'createdAt' | 'revokedAt'>
  }): Promise<boolean>
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
