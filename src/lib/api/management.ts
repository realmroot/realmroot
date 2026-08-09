import type { ManagementAgentAuditEvent } from '@shared/api/agent-api'
import type {
  ApplicationResponse,
  CreateApplicationRequest,
  CreateApplicationResponse,
  ListApplicationAuthorizationsQuery,
  ListApplicationAuthorizationsResponse,
  ListApplicationsQuery,
  ListApplicationsResponse,
  ListClientSecretsResponse,
  ListRedirectUrisResponse,
  PaginationMetadata,
  PaginationQuery,
  ReplaceRedirectUrisRequest,
  RotateClientSecretResponse,
  UpdateApplicationRequest,
} from '@shared/api/applications'
import type { UploadedAssetResponse } from '@shared/api/assets'
import type {
  AddMemberRequest,
  ApiResourceContractResponse,
  ApiResourceResponse,
  CreateApplicationScopeEntitlementRequest,
  CreateInvitationRequest,
  CreateOrganizationRequest,
  CreateRoleRequest,
  CreateUserScopeEntitlementRequest,
  InvitationResponse,
  ListInvitationsResponse,
  ListMembersResponse,
  ListScopeEntitlementsQuery,
  MemberResponse,
  MemberRolesResponse,
  OrganizationResponse,
  ReplaceMemberRolesRequest,
  RoleResponse,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
} from '@shared/api/authorization'
import type {
  ConnectorReadinessResponse,
  ConnectorResponse,
  ListConnectorTemplatesResponse,
} from '@shared/api/connectors'
import type {
  CreateManagementConnectorRequest,
  DeveloperConsoleAccessPolicyResponse,
  EmailDeliveryConfigurationResponse,
  ListManagementConnectorsResponse,
  ListManagementUserApplicationsResponse,
  ListManagementUserLinkedAccountsResponse,
  ListManagementUserPasskeysResponse,
  ListManagementUserSessionsResponse,
  ListManagementUsersResponse,
  ManagementAccountCenterSettingsResponse,
  ManagementBanUserRequest,
  ManagementBrandingSettingsResponse,
  ManagementCreateUserRequest,
  ManagementReadinessResponse,
  ManagementRealmResponse,
  ManagementSignInSettingsResponse,
  ManagementUpdateUserRequest,
  ManagementUserDetailResponse,
  ManagementUserListQuery,
  ManagementUserSecurityResponse,
  OrganizationCreationPolicyResponse,
  ReplaceDeveloperConsoleAccessPolicyRequest,
  ReplaceEmailDeliveryConfigurationRequest,
  ReplaceOrganizationCreationPolicyRequest,
  UpdateManagementAccountCenterSettingsRequest,
  UpdateManagementBrandingSettingsRequest,
  UpdateManagementConnectorRequest,
  UpdateManagementRealmRequest,
  UpdateManagementSignInSettingsRequest,
} from '@shared/api/management'
import type { SecurityPolicyResponse, UpdateSecurityPolicyInput } from '@shared/api/security'
import type {
  CreateWebhookEndpointRequest,
  ListWebhookDeliveryAttemptsResponse,
  ListWebhookEndpointsQuery,
  ListWebhookEndpointsResponse,
  ListWebhookRequestsQuery,
  ListWebhookRequestsResponse,
  UpdateWebhookEndpointRequest,
  WebhookDeliveryAttempt,
  WebhookEndpoint,
  WebhookEndpointSecretResponse,
  WebhookRequest,
} from '@shared/api/webhooks'
import type { ClientResponse } from 'hono/client'
import { apiClient, readJsonResponse, readNoContentResponse, readRpcResponse, uploadAsset } from '@/lib/api'
import { listApiResources } from './management-api-resources'

export { consoleQueryKeys } from './console-query-keys'

export type AdminDashboard = {
  applications: ListApplicationsResponse
  users: ListManagementUsersResponse
  connectors: ListManagementConnectorsResponse
  organizations: ListOrganizationsResponse
  apiResources: ListApiResourcesResponse
  signIn: ManagementSignInSettingsResponse
  security: { policy: SecurityPolicyResponse }
}

export type OrganizationDashboard = {
  organization: OrganizationResponse
  applications: ListApplicationsResponse
  users: ListManagementUsersResponse
  apiResources: Awaited<ReturnType<typeof listApiResources>>
  agents: Awaited<ReturnType<typeof getAgentInventory>>
  roles: ListRolesResponse
}

type ListOrganizationsResponse = {
  organizations: OrganizationResponse[]
  pagination: PaginationMetadata
}

type ListRolesResponse = {
  roles: RoleResponse[]
  pagination: PaginationMetadata
}

type ListApiResourcesResponse = {
  resources: ApiResourceResponse[]
  pagination: PaginationMetadata
}

export function getAdminDashboard(): Promise<AdminDashboard> {
  return Promise.all([
    listApplications(),
    listUsers(),
    listConnectors(),
    listOrganizations(),
    listApiResources(),
    getSignInSettings(),
    getSecurityPolicy(),
  ]).then(([applications, users, connectors, organizations, apiResources, signIn, security]) => ({
    applications,
    users,
    connectors,
    organizations,
    apiResources: { resources: apiResources.items, pagination: apiResources.pagination },
    signIn,
    security,
  }))
}

export function getOrganizationDashboard(organizationId: string): Promise<OrganizationDashboard> {
  return Promise.all([
    getOrganization(organizationId),
    listApplications({ ownerOrganizationId: organizationId }),
    listUsers({ organizationId, limit: 100 }),
    listApiResources({ ownerOrganizationId: organizationId }),
    getAgentInventory({ organizationId, limit: 100 }),
    listRoles(organizationId),
  ]).then(([organization, applications, users, apiResources, agents, roles]) => ({
    organization,
    applications,
    users,
    apiResources,
    agents,
    roles,
  }))
}

export function listApplications(query: Partial<ListApplicationsQuery> = {}) {
  const serialized = stringifyQuery(query)
  return readRpcResponse(
    Object.keys(serialized).length === 0
      ? apiClient.api.applications.$get()
      : apiClient.api.applications.$get({ query: serialized }),
  )
}

export function createApplication(input: CreateApplicationRequest): Promise<CreateApplicationResponse> {
  return readRpcResponse(apiClient.api.applications.$post({ json: input }))
}

export function getApplication(id: string): Promise<ApplicationResponse> {
  return readRpcResponse(apiClient.api.applications[':id'].$get({ param: { id } }))
}

export function updateApplication(id: string, input: UpdateApplicationRequest) {
  return readRpcResponse(apiClient.api.applications[':id'].$patch({ param: { id }, json: input }))
}

export function deleteApplication(id: string) {
  return readRpcResponse(apiClient.api.applications[':id'].$delete({ param: { id } }))
}

export function listApplicationRedirectUris(
  id: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListRedirectUrisResponse> {
  return readRpcResponse(
    apiClient.api.applications[':id']['redirect-uris'].$get({
      param: { id },
      query: stringifyQuery(query),
    }),
  )
}

export function replaceApplicationRedirectUris(id: string, input: ReplaceRedirectUrisRequest) {
  return readRpcResponse(apiClient.api.applications[':id']['redirect-uris'].$put({ param: { id }, json: input }))
}

export function listApplicationClientSecrets(
  id: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListClientSecretsResponse> {
  return readRpcResponse(
    apiClient.api.applications[':id']['client-secrets'].$get({
      param: { id },
      query: stringifyQuery(query),
    }),
  )
}

export function rotateApplicationClientSecret(id: string): Promise<RotateClientSecretResponse> {
  return readRpcResponse(apiClient.api.applications[':id']['client-secrets'].$post({ param: { id } }))
}

export function listApplicationAuthorizations(
  query: Partial<ListApplicationAuthorizationsQuery> = {},
): Promise<ListApplicationAuthorizationsResponse> {
  return readRpcResponse(
    apiClient.api.access.consents.$get({
      query: stringifyQuery(query),
    }),
  )
}

export function revokeApplicationAuthorization(authorizationId: string) {
  return readRpcResponse(
    apiClient.api.access.consents[':authorizationId'].revocation.$put({ param: { authorizationId } }),
  )
}

export async function uploadApplicationLogo(id: string, file: File): Promise<UploadedAssetResponse> {
  const uploaded = await uploadAsset('application_logo', file)
  await updateApplication(id, { iconUrl: uploaded.asset.publicUrl })
  return uploaded
}

export function listUsers(query: Partial<ManagementUserListQuery> = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  return readRpcResponse(
    params.size === 0
      ? apiClient.api.users.$get({ query: {} })
      : apiClient.api.users.$get({ query: Object.fromEntries(params) }),
  )
}

export function createUser(input: ManagementCreateUserRequest) {
  return readRpcResponse(apiClient.api.users.$post({ json: input }))
}

export function updateUser(id: string, input: ManagementUpdateUserRequest) {
  return readRpcResponse(apiClient.api.users[':id'].$patch({ param: { id }, json: input }))
}

export function getUser(id: string): Promise<ManagementUserDetailResponse> {
  return readRpcResponse(apiClient.api.users[':id'].$get({ param: { id } }))
}

export function deleteUser(id: string) {
  return readRpcResponse(apiClient.api.users[':id'].$delete({ param: { id } }))
}

export function requestUserPasswordReset(id: string) {
  return readRpcResponse(apiClient.api.users[':id']['password-reset-requests'].$post({ param: { id }, json: {} }))
}

export function banUser(id: string, input: ManagementBanUserRequest = {}) {
  return readRpcResponse(apiClient.api.users[':id'].suspension.$put({ param: { id }, json: input }))
}

export function unbanUser(id: string) {
  return readRpcResponse(apiClient.api.users[':id'].suspension.$delete({ param: { id } }))
}

export function listUserSessions(
  id: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListManagementUserSessionsResponse> {
  return readRpcResponse(apiClient.api.users[':id'].sessions.$get({ param: { id }, query: stringifyQuery(query) }))
}

export function revokeUserSessions(id: string) {
  return readRpcResponse(apiClient.api.users[':id'].sessions.$delete({ param: { id } }))
}

export function revokeUserSession(id: string, sessionId: string) {
  return readRpcResponse(apiClient.api.users[':id'].sessions[':sessionId'].$delete({ param: { id, sessionId } }))
}

export function listUserLinkedAccounts(
  id: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListManagementUserLinkedAccountsResponse> {
  return readRpcResponse(
    apiClient.api.users[':id']['linked-accounts'].$get({ param: { id }, query: stringifyQuery(query) }),
  )
}

export async function listUserApplications(
  id: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListManagementUserApplicationsResponse> {
  const [result, inventory] = await Promise.all([
    listApplicationAuthorizations({ ...query, userId: id, status: 'active', limit: query.limit ?? 100 }),
    listApplications({ limit: 100 }),
  ])
  const applicationsById = new Map(inventory.applications.map((application) => [application.id, application]))
  const applications = result.authorizations.map((authorization) => {
    const application = applicationsById.get(authorization.applicationId)
    return {
      id: authorization.id,
      applicationId: authorization.applicationId,
      applicationName: application?.name ?? authorization.applicationId,
      applicationSlug: application?.slug ?? authorization.applicationId,
      scopes: authorization.scopes,
      grantedAt: authorization.grantedAt,
      expiresAt: authorization.expiresAt,
    }
  })
  return {
    applications,
    pagination: result.pagination,
  }
}

export async function getUserSecurity(id: string): Promise<ManagementUserSecurityResponse> {
  const { security } = await getUser(id)
  if (!security) throw new Error('User security details require Realm-level access.')
  return { security }
}

export function listUserPasskeys(
  id: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListManagementUserPasskeysResponse> {
  return readRpcResponse(apiClient.api.users[':id'].passkeys.$get({ param: { id }, query: stringifyQuery(query) }))
}

export function deleteUserPasskey(id: string, passkeyId: string) {
  return readRpcResponse(apiClient.api.users[':id'].passkeys[':passkeyId'].$delete({ param: { id, passkeyId } }))
}

export function listConnectors() {
  return readRpcResponse(apiClient.api.connectors.$get())
}

export function listConnectorTemplates(): Promise<ListConnectorTemplatesResponse> {
  return readRpcResponse(apiClient.api.connectors.templates.$get())
}

export function createConnector(input: CreateManagementConnectorRequest) {
  return readRpcResponse(apiClient.api.connectors.$post({ json: input }))
}

export function getConnector(id: string): Promise<ConnectorResponse> {
  return readRpcResponse(apiClient.api.connectors[':id'].$get({ param: { id } }))
}

export function updateConnector(id: string, input: UpdateManagementConnectorRequest) {
  return readRpcResponse(apiClient.api.connectors[':id'].$patch({ param: { id }, json: input }))
}

export function deleteConnector(id: string) {
  return readRpcResponse(apiClient.api.connectors[':id'].$delete({ param: { id } }))
}

export function getConnectorReadiness(id: string): Promise<ConnectorReadinessResponse> {
  return readRpcResponse(apiClient.api.connectors[':id'].readiness.$get({ param: { id } }))
}

export function getSignInSettings() {
  return readRpcResponse(apiClient.api.realm['sign-in-policy'].$get())
}

export function updateSignInSettings(input: UpdateManagementSignInSettingsRequest) {
  return readRpcResponse(apiClient.api.realm['sign-in-policy'].$patch({ json: input }))
}

export function getBrandingSettings(): Promise<ManagementBrandingSettingsResponse> {
  return readRpcResponse(apiClient.api.realm.branding.$get())
}

export function updateBrandingSettings(input: UpdateManagementBrandingSettingsRequest) {
  return readRpcResponse(apiClient.api.realm.branding.$patch({ json: input }))
}

export function getAccountCenterSettings(): Promise<ManagementAccountCenterSettingsResponse> {
  return readRpcResponse(apiClient.api.realm['account-management-policy'].$get())
}

export function updateAccountCenterSettings(input: UpdateManagementAccountCenterSettingsRequest) {
  return readRpcResponse(apiClient.api.realm['account-management-policy'].$patch({ json: input }))
}

export type DeveloperSettingsViewModel = {
  organizationCreation: OrganizationCreationPolicyResponse['mode']
  approvedUserIds: string[]
  consoleAccess: DeveloperConsoleAccessPolicyResponse['mode']
  eligibleAccessLevels: DeveloperConsoleAccessPolicyResponse['eligibleAccessLevels']
  selectedOrganizationIds: string[]
  organizationCreationEtag: string
  consoleAccessEtag: string
}

export async function getDeveloperSettings(): Promise<DeveloperSettingsViewModel> {
  const [organizationCreation, consoleAccess] = await Promise.all([
    readVersionedResponse<OrganizationCreationPolicyResponse>(
      apiClient.api.realm['organization-creation-policy'].$get(),
    ),
    readVersionedResponse<DeveloperConsoleAccessPolicyResponse>(
      apiClient.api.realm['developer-console-access-policy'].$get(),
    ),
  ])
  return developerSettingsViewModel(organizationCreation, consoleAccess)
}

export async function updateDeveloperSettings(input: DeveloperSettingsViewModel): Promise<DeveloperSettingsViewModel> {
  const organizationCreation: ReplaceOrganizationCreationPolicyRequest = {
    mode: input.organizationCreation,
    approvedUserIds: input.approvedUserIds,
  }
  const consoleAccess: ReplaceDeveloperConsoleAccessPolicyRequest = {
    mode: input.consoleAccess,
    eligibleAccessLevels: input.eligibleAccessLevels,
    selectedOrganizationIds: input.selectedOrganizationIds,
  }
  const [savedOrganizationCreation, savedConsoleAccess] = await Promise.all([
    readVersionedResponse<OrganizationCreationPolicyResponse>(
      apiClient.api.realm['organization-creation-policy'].$put({
        json: organizationCreation,
        header: { 'If-Match': input.organizationCreationEtag },
      }),
    ),
    readVersionedResponse<DeveloperConsoleAccessPolicyResponse>(
      apiClient.api.realm['developer-console-access-policy'].$put({
        json: consoleAccess,
        header: { 'If-Match': input.consoleAccessEtag },
      }),
    ),
  ])
  return developerSettingsViewModel(savedOrganizationCreation, savedConsoleAccess)
}

export function getRealm(): Promise<ManagementRealmResponse & { etag: string }> {
  return readVersionedResponse<ManagementRealmResponse>(apiClient.api.realm.$get())
}

export function updateRealm({ input, etag }: { input: UpdateManagementRealmRequest; etag: string }) {
  return readVersionedResponse<ManagementRealmResponse>(
    apiClient.api.realm.$patch({ json: input, header: { 'If-Match': etag } }),
  )
}

export function getEmailDeliveryConfiguration(): Promise<EmailDeliveryConfigurationResponse & { etag: string }> {
  return readVersionedResponse<EmailDeliveryConfigurationResponse>(
    apiClient.api.realm['email-delivery-configuration'].$get(),
  )
}

export function replaceEmailDeliveryConfiguration({
  input,
  etag,
}: {
  input: ReplaceEmailDeliveryConfigurationRequest
  etag: string
}) {
  return readVersionedResponse<EmailDeliveryConfigurationResponse>(
    apiClient.api.realm['email-delivery-configuration'].$put({ json: input, header: { 'If-Match': etag } }),
  )
}

function developerSettingsViewModel(
  organizationCreation: OrganizationCreationPolicyResponse & { etag: string },
  consoleAccess: DeveloperConsoleAccessPolicyResponse & { etag: string },
): DeveloperSettingsViewModel {
  return {
    organizationCreation: organizationCreation.mode,
    approvedUserIds: organizationCreation.approvedUserIds,
    consoleAccess: consoleAccess.mode,
    eligibleAccessLevels: consoleAccess.eligibleAccessLevels,
    selectedOrganizationIds: consoleAccess.selectedOrganizationIds,
    organizationCreationEtag: organizationCreation.etag,
    consoleAccessEtag: consoleAccess.etag,
  }
}

async function readVersionedResponse<T extends object, Status extends number = number>(
  request: Promise<ClientResponse<T, Status, 'json'>>,
): Promise<T & { etag: string }> {
  const response = await request
  const etag = response.headers.get('etag')
  if (!etag) throw new Error('Versioned resource response did not include an ETag.')
  const representation = (await readRpcResponse(Promise.resolve(response))) as T
  return { ...representation, etag }
}

export function getAdminReadiness(): Promise<ManagementReadinessResponse> {
  return readRpcResponse(apiClient.api.realm['configuration-status'].$get())
}

export function getAgentInventory(query: Partial<import('@shared/api/agent-api').ListAgentsQuery> = {}): Promise<{
  items: import('@shared/api/agent-api').ManagementAgent[]
  pagination: PaginationMetadata
}> {
  const serialized = stringifyQuery(query)
  return readRpcResponse(
    Object.keys(serialized).length === 0
      ? apiClient.api.agents.$get()
      : apiClient.api.agents.$get({ query: serialized }),
  )
}

export function getAgent(agentId: string): Promise<{ agent: import('@shared/api/agent-api').ManagementAgent }> {
  return readRpcResponse(apiClient.api.agents[':agentId'].$get({ param: { agentId } }))
}

export function listAgentInstallations(agentId: string, query: Partial<PaginationQuery> = {}) {
  return readRpcResponse(
    apiClient.api.agents[':agentId'].installations.$get({ param: { agentId }, query: stringifyQuery(query) }),
  )
}

export function listAgentAccessRequests(
  query: Partial<import('@shared/api/agent-api').ListManagementAgentAccessRequestsQuery> = {},
) {
  return readRpcResponse(apiClient.api.access.requests.$get({ query: stringifyQuery(query) }))
}

export function listAgentScopeEntitlements(
  agentId: string,
  query: Partial<import('@shared/api/agent-api').ListAgentScopeEntitlementsQuery> = {},
) {
  return readRpcResponse(
    apiClient.api.agents[':agentId']['scope-entitlements'].$get({
      param: { agentId },
      query: stringifyQuery(query),
    }),
  )
}

export function deleteAgentScopeEntitlement(agentId: string, entitlementId: string) {
  return readRpcResponse(
    apiClient.api.agents[':agentId']['scope-entitlements'][':entitlementId'].$delete({
      param: { agentId, entitlementId },
    }),
  )
}

export function listUserScopeEntitlements(userId: string, query: Partial<ListScopeEntitlementsQuery> = {}) {
  return readRpcResponse(
    apiClient.api.users[':userId']['scope-entitlements'].$get({
      param: { userId },
      query: stringifyQuery(query),
    }),
  )
}

export function createUserScopeEntitlement(userId: string, input: CreateUserScopeEntitlementRequest) {
  return readRpcResponse(apiClient.api.users[':userId']['scope-entitlements'].$post({ param: { userId }, json: input }))
}

export function deleteUserScopeEntitlement(userId: string, entitlementId: string) {
  return readRpcResponse(
    apiClient.api.users[':userId']['scope-entitlements'][':entitlementId'].$delete({
      param: { userId, entitlementId },
    }),
  )
}

export function listApplicationScopeEntitlements(
  applicationId: string,
  query: Partial<ListScopeEntitlementsQuery> = {},
) {
  return readRpcResponse(
    apiClient.api.applications[':applicationId']['scope-entitlements'].$get({
      param: { applicationId },
      query: stringifyQuery(query),
    }),
  )
}

export function createApplicationScopeEntitlement(
  applicationId: string,
  input: CreateApplicationScopeEntitlementRequest,
) {
  return readRpcResponse(
    apiClient.api.applications[':applicationId']['scope-entitlements'].$post({
      param: { applicationId },
      json: input,
    }),
  )
}

export function deleteApplicationScopeEntitlement(applicationId: string, entitlementId: string) {
  return readRpcResponse(
    apiClient.api.applications[':applicationId']['scope-entitlements'][':entitlementId'].$delete({
      param: { applicationId, entitlementId },
    }),
  )
}

export function getAgentAuditEvents(
  query: Partial<import('@shared/api/agent-api').ListAgentAuditEventsQuery> = {},
): Promise<{
  items: ManagementAgentAuditEvent[]
  pagination: PaginationMetadata
}> {
  return readRpcResponse(apiClient.api.realm['audit-events'].$get({ query: stringifyQuery(query) }))
}

export function activateAgent(agentId: string) {
  return readRpcResponse(apiClient.api.agents[':agentId'].activation.$put({ param: { agentId } }))
}

export function deactivateAgent(agentId: string) {
  return readRpcResponse(apiClient.api.agents[':agentId'].activation.$delete({ param: { agentId } }))
}

export function deleteAgent(agentId: string) {
  return readRpcResponse(apiClient.api.agents[':agentId'].$delete({ param: { agentId } }))
}

export function listWebhookEndpoints(
  query: Partial<ListWebhookEndpointsQuery> = {},
): Promise<ListWebhookEndpointsResponse> {
  return readRpcResponse(apiClient.api.webhooks.$get({ query: stringifyWebhookQuery(query) }))
}

export function createWebhookEndpoint(input: CreateWebhookEndpointRequest): Promise<WebhookEndpointSecretResponse> {
  return readRpcResponse(apiClient.api.webhooks.$post({ json: input }))
}

export function updateWebhookEndpoint(id: string, input: UpdateWebhookEndpointRequest): Promise<WebhookEndpoint> {
  return readRpcResponse(apiClient.api.webhooks[':id'].$patch({ param: { id }, json: input }))
}

export function deleteWebhookEndpoint(id: string) {
  return readRpcResponse(apiClient.api.webhooks[':id'].$delete({ param: { id } }))
}

export function rotateWebhookEndpointSecret(id: string): Promise<WebhookEndpointSecretResponse> {
  return readRpcResponse(apiClient.api.webhooks[':id'].secrets.$post({ param: { id } }))
}

export async function listWebhookRequests(
  query: Partial<ListWebhookRequestsQuery> = {},
): Promise<ListWebhookRequestsResponse> {
  const endpointIds = query.endpointId
    ? [query.endpointId]
    : (await listWebhookEndpoints({ organizationId: query.organizationId, limit: 100 })).endpoints.map(({ id }) => id)
  const childQuery = { ...query, endpointId: undefined }
  const responses = await Promise.all(
    endpointIds.map((id) =>
      readRpcResponse(
        apiClient.api.webhooks[':id'].deliveries.$get({ param: { id }, query: stringifyWebhookQuery(childQuery) }),
      ),
    ),
  )
  const requests = responses.flatMap((response) => response.requests)
  return {
    requests,
    pagination: { offset: 0, limit: requests.length, total: requests.length, hasMore: false, nextOffset: null },
  }
}

export function getWebhookRequest(endpointId: string, deliveryId: string): Promise<WebhookRequest> {
  return readRpcResponse(
    apiClient.api.webhooks[':id'].deliveries[':deliveryId'].$get({ param: { id: endpointId, deliveryId } }),
  )
}

export function listWebhookDeliveryAttempts(
  endpointId: string,
  deliveryId: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListWebhookDeliveryAttemptsResponse> {
  return readRpcResponse(
    apiClient.api.webhooks[':id'].deliveries[':deliveryId'].attempts.$get({
      param: { id: endpointId, deliveryId },
      query: stringifyQuery(query),
    }),
  )
}

export function createWebhookDeliveryAttempt(
  endpointId: string,
  deliveryId: string,
  idempotencyKey: string,
): Promise<WebhookDeliveryAttempt> {
  return readRpcResponse(
    apiClient.api.webhooks[':id'].deliveries[':deliveryId'].attempts.$post({
      param: { id: endpointId, deliveryId },
      header: { 'Idempotency-Key': idempotencyKey },
    }),
  )
}

export function getSecurityPolicy() {
  return readRpcResponse(apiClient.api.realm['security-policy'].$get()) as Promise<{ policy: SecurityPolicyResponse }>
}

export function updateSecurityPolicy(input: UpdateSecurityPolicyInput) {
  return readRpcResponse(apiClient.api.realm['security-policy'].$patch({ json: input })) as Promise<{
    policy: SecurityPolicyResponse
  }>
}

export function listOrganizations() {
  return readRpcResponse(apiClient.api.organizations.$get())
}

export function getOrganization(id: string): Promise<OrganizationResponse> {
  return readRpcResponse(apiClient.api.organizations[':id'].$get({ param: { id } }))
}

export function createOrganization(input: CreateOrganizationRequest) {
  return readRpcResponse(apiClient.api.organizations.$post({ json: input }))
}

export function updateOrganization(id: string, input: UpdateOrganizationRequest) {
  return readRpcResponse(apiClient.api.organizations[':id'].$patch({ param: { id }, json: input }))
}

export function deleteOrganization(id: string) {
  return fetch(`/api/organizations/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(readNoContentResponse)
}

export function listOrganizationMembers(id: string): Promise<ListMembersResponse> {
  return fetch(`/api/organizations/${encodeURIComponent(id)}/members`).then(readJsonResponse<ListMembersResponse>)
}

export function addOrganizationMember(id: string, input: AddMemberRequest): Promise<MemberResponse> {
  return fetch(`/api/organizations/${encodeURIComponent(id)}/members`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then(readJsonResponse<MemberResponse>)
}

export function updateOrganizationMember(
  id: string,
  memberId: string,
  input: UpdateMemberRequest,
): Promise<MemberResponse> {
  return fetch(`/api/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then(readJsonResponse<MemberResponse>)
}

export function removeOrganizationMember(id: string, memberId: string) {
  return fetch(`/api/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, {
    method: 'DELETE',
  }).then(readNoContentResponse)
}

export function listOrganizationInvitations(id: string): Promise<ListInvitationsResponse> {
  return fetch(`/api/organizations/${encodeURIComponent(id)}/invitations`).then(
    readJsonResponse<ListInvitationsResponse>,
  )
}

export function createOrganizationInvitation(id: string, input: CreateInvitationRequest): Promise<InvitationResponse> {
  return fetch(`/api/organizations/${encodeURIComponent(id)}/invitations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then(readJsonResponse<InvitationResponse>)
}

export function cancelOrganizationInvitation(id: string, invitationId: string) {
  return fetch(`/api/organizations/${encodeURIComponent(id)}/invitations/${encodeURIComponent(invitationId)}`, {
    method: 'DELETE',
  }).then(readNoContentResponse)
}

export async function uploadOrganizationLogo(id: string, file: File): Promise<UploadedAssetResponse> {
  const uploaded = await uploadAsset('organization_logo', file)
  await updateOrganization(id, { logo: uploaded.asset.publicUrl })
  return uploaded
}

export async function uploadBrandingLogo(file: File): Promise<UploadedAssetResponse> {
  const uploaded = await uploadAsset('branding_logo', file)
  await updateBrandingSettings({ branding: { logoUrl: uploaded.asset.publicUrl } })
  return uploaded
}

export async function uploadBrandingFavicon(file: File): Promise<UploadedAssetResponse> {
  const uploaded = await uploadAsset('favicon', file)
  await updateBrandingSettings({ branding: { faviconUrl: uploaded.asset.publicUrl } })
  return uploaded
}

export function listRoles(organizationId: string) {
  return readRpcResponse(apiClient.api.organizations[':organizationId'].roles.$get({ param: { organizationId } }))
}

export function getRole(organizationId: string, roleKey: string): Promise<RoleResponse> {
  return readRpcResponse(
    apiClient.api.organizations[':organizationId'].roles[':roleKey'].$get({ param: { organizationId, roleKey } }),
  )
}

export function createRole(organizationId: string, input: CreateRoleRequest) {
  return readRpcResponse(
    apiClient.api.organizations[':organizationId'].roles.$post({ param: { organizationId }, json: input }),
  )
}

export function updateRole(organizationId: string, roleKey: string, input: UpdateRoleRequest) {
  return readRpcResponse(
    apiClient.api.organizations[':organizationId'].roles[':roleKey'].$patch({
      param: { organizationId, roleKey },
      json: input,
    }),
  )
}

export function deleteRole(organizationId: string, roleKey: string) {
  return readRpcResponse(
    apiClient.api.organizations[':organizationId'].roles[':roleKey'].$delete({ param: { organizationId, roleKey } }),
  )
}

export function getOrganizationMemberRoles(organizationId: string, memberId: string): Promise<MemberRolesResponse> {
  return readRpcResponse(
    apiClient.api.organizations[':organizationId'].members[':memberId'].roles.$get({
      param: { organizationId, memberId },
    }),
  )
}

export function replaceOrganizationMemberRoles(
  organizationId: string,
  memberId: string,
  input: ReplaceMemberRolesRequest,
) {
  return readRpcResponse(
    apiClient.api.organizations[':organizationId'].members[':memberId'].roles.$put({
      param: { organizationId, memberId },
      json: input,
    }),
  )
}

export function getApiResourceContract(id: string): Promise<ApiResourceContractResponse> {
  return readRpcResponse(apiClient.api['resource-servers'][':id'].contract.$get({ param: { id } }))
}

export {
  createApiResource,
  deleteApiResource,
  getApiResource,
  listApiResources,
  refreshApiResourceScopeRegistry,
  updateApiResource,
} from './management-api-resources'

export {
  createFederatedCredential,
  deleteFederatedCredential,
  listFederatedCredentials,
  updateFederatedCredential,
} from './management-federated-credentials'

function stringifyQuery(query: Partial<PaginationQuery>): Partial<Record<keyof PaginationQuery, string>> {
  return Object.fromEntries(
    Object.entries(query)
      .filter((entry): entry is [keyof PaginationQuery, number] => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )
}

function stringifyWebhookQuery<T extends Record<string, unknown>>(query: Partial<T>): Partial<Record<keyof T, string>> {
  return Object.fromEntries(
    Object.entries(query)
      .filter((entry): entry is [keyof T & string, Exclude<T[keyof T], undefined>] => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  ) as Partial<Record<keyof T, string>>
}
