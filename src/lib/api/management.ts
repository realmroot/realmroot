import type { AgentAuditEvent } from '@shared/api/agents'
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
  CreateInvitationRequest,
  CreateOrganizationRequest,
  CreateRoleAssignmentRequest,
  CreateRoleRequest,
  InvitationResponse,
  ListInvitationsResponse,
  ListMembersResponse,
  ListRoleAssignmentsQuery,
  ListRoleAssignmentsResponse,
  MemberResponse,
  OrganizationResponse,
  RolePermissionsResponse,
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
import { apiClient, readJsonResponse, readNoContentResponse, readRpcResponse, uploadApiFile } from '@/lib/api'
import { listApiResources } from './management-api-resources'

export { consoleQueryKeys } from './console-query-keys'

export type AdminDashboard = {
  applications: ListApplicationsResponse
  users: ListManagementUsersResponse
  connectors: ListManagementConnectorsResponse
  organizations: ListOrganizationsResponse
  roles: ListRolesResponse
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
  assignments: ListRoleAssignmentsResponse
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
    listRoles(),
    listApiResources(),
    getSignInSettings(),
    getSecurityPolicy(),
  ]).then(([applications, users, connectors, organizations, roles, apiResources, signIn, security]) => ({
    applications,
    users,
    connectors,
    organizations,
    roles,
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
    listRoleAssignments({ organizationId, limit: 100 }),
  ]).then(([organization, applications, users, apiResources, agents, assignments]) => ({
    organization,
    applications,
    users,
    apiResources,
    agents,
    assignments,
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
    apiClient.api['application-authorizations'].$get({
      query: stringifyQuery(query),
    }),
  )
}

export function revokeApplicationAuthorization(authorizationId: string) {
  return readRpcResponse(
    apiClient.api['application-authorizations'][':authorizationId'].revocation.$put({ param: { authorizationId } }),
  )
}

export function uploadApplicationLogo(id: string, file: File): Promise<UploadedAssetResponse> {
  return uploadApiFile(`/api/applications/${id}/logo`, file)
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

export function requestPasswordReset(email: string) {
  return readRpcResponse(apiClient.api.users['password-reset-requests'].$post({ json: { email } }))
}

export function requestUserPasswordReset(id: string) {
  return readRpcResponse(apiClient.api.users[':id']['password-reset-requests'].$post({ param: { id }, json: {} }))
}

export function banUser(id: string, input: ManagementBanUserRequest = {}) {
  return readRpcResponse(apiClient.api.users[':id'].ban.$put({ param: { id }, json: input }))
}

export function unbanUser(id: string) {
  return readRpcResponse(apiClient.api.users[':id'].ban.$delete({ param: { id } }))
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

export function listUserApplications(
  id: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListManagementUserApplicationsResponse> {
  return readRpcResponse(apiClient.api.users[':id'].applications.$get({ param: { id }, query: stringifyQuery(query) }))
}

export function getUserSecurity(id: string): Promise<ManagementUserSecurityResponse> {
  return readRpcResponse(apiClient.api.users[':id'].security.$get({ param: { id } }))
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
  return readRpcResponse(apiClient.api['sign-in-settings'].$get())
}

export function updateSignInSettings(input: UpdateManagementSignInSettingsRequest) {
  return readRpcResponse(apiClient.api['sign-in-settings'].$patch({ json: input }))
}

export function getBrandingSettings(): Promise<ManagementBrandingSettingsResponse> {
  return readRpcResponse(apiClient.api['branding-settings'].$get())
}

export function updateBrandingSettings(input: UpdateManagementBrandingSettingsRequest) {
  return readRpcResponse(apiClient.api['branding-settings'].$patch({ json: input }))
}

export function getAccountCenterSettings(): Promise<ManagementAccountCenterSettingsResponse> {
  return readRpcResponse(apiClient.api['account-center-settings'].$get())
}

export function updateAccountCenterSettings(input: UpdateManagementAccountCenterSettingsRequest) {
  return readRpcResponse(apiClient.api['account-center-settings'].$patch({ json: input }))
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
    readVersionedResponse<OrganizationCreationPolicyResponse>(apiClient.api['organization-creation-policy'].$get()),
    readVersionedResponse<DeveloperConsoleAccessPolicyResponse>(
      apiClient.api['developer-console-access-policy'].$get(),
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
      apiClient.api['organization-creation-policy'].$put({
        json: organizationCreation,
        header: { 'If-Match': input.organizationCreationEtag },
      }),
    ),
    readVersionedResponse<DeveloperConsoleAccessPolicyResponse>(
      apiClient.api['developer-console-access-policy'].$put({
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
  return readVersionedResponse<EmailDeliveryConfigurationResponse>(apiClient.api['email-delivery-configuration'].$get())
}

export function replaceEmailDeliveryConfiguration({
  input,
  etag,
}: {
  input: ReplaceEmailDeliveryConfigurationRequest
  etag: string
}) {
  return readVersionedResponse<EmailDeliveryConfigurationResponse>(
    apiClient.api['email-delivery-configuration'].$put({ json: input, header: { 'If-Match': etag } }),
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
  return readRpcResponse(apiClient.api.readiness.$get())
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

export async function listAgentRoles(agentId: string, query: Partial<PaginationQuery> = {}) {
  const [assignments, roles] = await Promise.all([
    listRoleAssignments({ ...query, subjectType: 'agent', subjectId: agentId, status: 'active' }),
    listRoles(),
  ])
  const assignedRoleIds = new Set(assignments.assignments.map((assignment) => assignment.roleId))
  return {
    items: roles.roles.filter((role) => assignedRoleIds.has(role.id)),
    pagination: assignments.pagination,
  }
}

export function listAgentAccessRequests(
  query: Partial<import('@shared/api/agent-api').ListManagementAgentAccessRequestsQuery> = {},
) {
  return readRpcResponse(apiClient.api['agent-access-requests'].$get({ query: stringifyQuery(query) }))
}

export function listAgentAccessGrants(
  query: Partial<import('@shared/api/agent-api').ListManagementAgentAccessGrantsQuery> = {},
) {
  return readRpcResponse(apiClient.api['agent-access-grants'].$get({ query: stringifyQuery(query) }))
}

export function getAgentAuditEvents(
  query: Partial<import('@shared/api/agent-api').ListAgentAuditEventsQuery> = {},
): Promise<{
  items: AgentAuditEvent[]
  pagination: PaginationMetadata
}> {
  return readRpcResponse(apiClient.api['audit-events'].$get({ query: stringifyQuery(query) }))
}

export function emergencyRetireAgent(agentId: string) {
  return readRpcResponse(apiClient.api.agents[':agentId'].$delete({ param: { agentId } }))
}

export function listWebhookEndpoints(
  query: Partial<ListWebhookEndpointsQuery> = {},
): Promise<ListWebhookEndpointsResponse> {
  return readRpcResponse(apiClient.api.webhooks.endpoints.$get({ query: stringifyWebhookQuery(query) }))
}

export function createWebhookEndpoint(input: CreateWebhookEndpointRequest): Promise<WebhookEndpointSecretResponse> {
  return readRpcResponse(apiClient.api.webhooks.endpoints.$post({ json: input }))
}

export function updateWebhookEndpoint(id: string, input: UpdateWebhookEndpointRequest): Promise<WebhookEndpoint> {
  return readRpcResponse(apiClient.api.webhooks.endpoints[':id'].$patch({ param: { id }, json: input }))
}

export function deleteWebhookEndpoint(id: string) {
  return readRpcResponse(apiClient.api.webhooks.endpoints[':id'].$delete({ param: { id } }))
}

export function rotateWebhookEndpointSecret(id: string): Promise<WebhookEndpointSecretResponse> {
  return readRpcResponse(apiClient.api.webhooks.endpoints[':id'].secrets.$post({ param: { id } }))
}

export function listWebhookRequests(
  query: Partial<ListWebhookRequestsQuery> = {},
): Promise<ListWebhookRequestsResponse> {
  return readRpcResponse(apiClient.api.webhooks.requests.$get({ query: stringifyWebhookQuery(query) }))
}

export function getWebhookRequest(id: string): Promise<WebhookRequest> {
  return readRpcResponse(apiClient.api.webhooks.requests[':id'].$get({ param: { id } }))
}

export function listWebhookDeliveryAttempts(
  id: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListWebhookDeliveryAttemptsResponse> {
  return readRpcResponse(
    apiClient.api.webhooks.requests[':id'].attempts.$get({ param: { id }, query: stringifyQuery(query) }),
  )
}

export function createWebhookDeliveryAttempt(id: string, idempotencyKey: string): Promise<WebhookDeliveryAttempt> {
  return readRpcResponse(
    apiClient.api.webhooks.requests[':id'].attempts.$post({
      param: { id },
      header: { 'Idempotency-Key': idempotencyKey },
    }),
  )
}

export function getSecurityPolicy() {
  return readRpcResponse(apiClient.api.security.policy.$get()) as Promise<{ policy: SecurityPolicyResponse }>
}

export function updateSecurityPolicy(input: UpdateSecurityPolicyInput) {
  return readRpcResponse(apiClient.api.security.policy.$patch({ json: input })) as Promise<{
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

export function uploadOrganizationLogo(id: string, file: File): Promise<UploadedAssetResponse> {
  return uploadApiFile(`/api/organizations/${id}/logo`, file)
}

export function uploadBrandingLogo(file: File): Promise<UploadedAssetResponse> {
  return uploadApiFile('/api/branding/logo', file)
}

export function uploadBrandingFavicon(file: File): Promise<UploadedAssetResponse> {
  return uploadApiFile('/api/branding/favicon', file)
}

export function listRoles() {
  return readRpcResponse(apiClient.api.roles.$get())
}

export function getRole(id: string): Promise<RoleResponse> {
  return readRpcResponse(apiClient.api.roles[':id'].$get({ param: { id } }))
}

export function createRole(input: CreateRoleRequest) {
  return readRpcResponse(apiClient.api.roles.$post({ json: input }))
}

export function updateRole(id: string, input: UpdateRoleRequest) {
  return readRpcResponse(apiClient.api.roles[':id'].$patch({ param: { id }, json: input }))
}

export function deleteRole(id: string) {
  return readRpcResponse(apiClient.api.roles[':id'].$delete({ param: { id } }))
}

export async function listRolePermissions(id: string): Promise<RolePermissionsResponse & { etag: string }> {
  const response = await fetch(`/api/roles/${encodeURIComponent(id)}/permissions`, { credentials: 'same-origin' })
  const permissions = await readJsonResponse<RolePermissionsResponse>(response)
  const etag = response.headers.get('etag')
  if (!etag) throw new Error('Role permissions response did not include an ETag.')
  return { ...permissions, etag }
}

export function replaceRolePermissions(
  id: string,
  permissions: Array<{ resourceId: string; scope: string }>,
  etag: string,
) {
  return fetch(`/api/roles/${encodeURIComponent(id)}/permissions`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'if-match': etag },
    body: JSON.stringify({ permissions }),
  }).then((response) => readJsonResponse<RolePermissionsResponse>(response))
}

export function listRoleAssignments(
  query: Partial<ListRoleAssignmentsQuery> = {},
): Promise<ListRoleAssignmentsResponse> {
  return readRpcResponse(
    apiClient.api['role-assignments'].$get({
      query: stringifyQuery(query) as Partial<Record<keyof ListRoleAssignmentsQuery, string>>,
    }),
  )
}

export function createRoleAssignment(input: CreateRoleAssignmentRequest) {
  return readRpcResponse(apiClient.api['role-assignments'].$post({ json: input }))
}

export function revokeRoleAssignment(id: string) {
  return readRpcResponse(apiClient.api['role-assignments'][':id'].revocation.$put({ param: { id } }))
}

export function getApiResourceContract(id: string): Promise<ApiResourceContractResponse> {
  return readRpcResponse(apiClient.api['api-resources'][':id'].contract.$get({ param: { id } }))
}

export {
  archiveApiResource,
  createApiResource,
  deleteApiResource,
  getApiResource,
  listApiResources,
  restoreApiResource,
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
