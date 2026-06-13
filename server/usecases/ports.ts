/**
 * Ports: the interfaces the usecases depend on for everything beyond the
 * process boundary (persistence, external services). Adapters implement these;
 * usecases consume them. Port records are plain, framework-free shapes — they
 * never reference the drizzle schema, so this file stays inside the usecase
 * layer's dependency budget.
 */
import type { AccountProfileUpdateInput } from '@shared/api/account'
import type { AssetPurpose } from '@shared/api/assets'
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
