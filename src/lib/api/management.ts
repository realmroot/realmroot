import type { AgentAuditEvent } from '@shared/api/agents'
import type {
  ApplicationResponse,
  CreateApplicationRequest,
  CreateApplicationResponse,
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
  ApiResourceResponse,
  AssignRoleRequest,
  CreateOrganizationRequest,
  CreateRoleRequest,
  OrganizationResponse,
  RoleResponse,
  RoleScopesResponse,
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
  ManagementSignInSettingsResponse,
  ManagementUpdateUserRequest,
  ManagementUserDetailResponse,
  ManagementUserListQuery,
  ManagementUserSecurityResponse,
  UpdateManagementAccountCenterSettingsRequest,
  UpdateManagementBrandingSettingsRequest,
  UpdateManagementConnectorRequest,
  UpdateManagementSignInSettingsRequest,
} from '@shared/api/management'
import type { SecurityPolicy, UpdateSecurityPolicyInput } from '@shared/api/security'
import type {
  CreateWebhookEndpointRequest,
  ListWebhookEndpointsQuery,
  ListWebhookEndpointsResponse,
  ListWebhookRequestsQuery,
  ListWebhookRequestsResponse,
  UpdateWebhookEndpointRequest,
  WebhookEndpoint,
  WebhookEndpointSecretResponse,
  WebhookRequest,
} from '@shared/api/webhooks'
import { apiClient, readRpcResponse, uploadApiFile } from '@/lib/api'
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
  security: { policy: SecurityPolicy }
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

export function listApplications() {
  return readRpcResponse(apiClient.api.applications.$get())
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

export function uploadApplicationLogo(id: string, file: File): Promise<UploadedAssetResponse> {
  return uploadApiFile(`/api/applications/${id}/logo`, file)
}

export function listUsers(query: Partial<ManagementUserListQuery> = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  return readRpcResponse(apiClient.api.users.$get({ query: Object.fromEntries(params) }))
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

export function getAdminReadiness(): Promise<ManagementReadinessResponse> {
  return readRpcResponse(apiClient.api.readiness.$get())
}

export function getAgentInventory(): Promise<{
  items: import('@shared/api/agent-api').Agent[]
  pagination: PaginationMetadata
}> {
  return readRpcResponse(apiClient.api.agents.$get())
}

export function getAgentAuditEvents(): Promise<{
  items: AgentAuditEvent[]
  pagination: PaginationMetadata
}> {
  return readRpcResponse(apiClient.api['audit-events'].$get())
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

export function retryWebhookRequest(id: string): Promise<WebhookRequest> {
  return readRpcResponse(apiClient.api.webhooks.requests[':id'].retries.$post({ param: { id } }))
}

export function getSecurityPolicy() {
  return readRpcResponse(apiClient.api.security.policy.$get())
}

export function updateSecurityPolicy(input: UpdateSecurityPolicyInput) {
  return readRpcResponse(apiClient.api.security.policy.$patch({ json: input }))
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

export function listRoleScopes(id: string): Promise<RoleScopesResponse> {
  return readRpcResponse(apiClient.api.roles[':id'].scopes.$get({ param: { id } }))
}

export function replaceRoleScopes(id: string, scopes: string[]) {
  return readRpcResponse(apiClient.api.roles[':id'].scopes.$put({ param: { id }, json: { scopes } }))
}

export function assignUserRole(input: AssignRoleRequest) {
  return readRpcResponse(apiClient.api.roles.assignments.users.$post({ json: input }))
}

export function assignApplicationRole(input: AssignRoleRequest) {
  return readRpcResponse(apiClient.api.roles.assignments.applications.$post({ json: input }))
}

export function assignMemberRole(input: AssignRoleRequest) {
  return readRpcResponse(apiClient.api.roles.assignments.members.$post({ json: input }))
}

export function assignAgentRole(input: AssignRoleRequest) {
  return readRpcResponse(apiClient.api.roles.assignments.agents.$post({ json: input }))
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
