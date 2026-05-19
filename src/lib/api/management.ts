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
  ApiPermissionResponse,
  ApiResourceResponse,
  ApiScopeResponse,
  AssignRoleRequest,
  CreateApiPermissionRequest,
  CreateApiResourceRequest,
  CreateApiScopeRequest,
  CreateOrganizationRequest,
  CreateRoleRequest,
  ListApiPermissionsResponse,
  ListApiScopesResponse,
  OrganizationResponse,
  RolePermissionsResponse,
  RoleResponse,
  UpdateApiPermissionRequest,
  UpdateApiResourceRequest,
  UpdateApiScopeRequest,
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
  ListManagementUsersResponse,
  ManagementBrandingSettingsResponse,
  ManagementCreateUserRequest,
  ManagementReadinessResponse,
  ManagementSignInSettingsResponse,
  ManagementUpdateUserRequest,
  ManagementUserListQuery,
  UpdateManagementBrandingSettingsRequest,
  UpdateManagementConnectorRequest,
  UpdateManagementSignInSettingsRequest,
} from '@shared/api/management'
import type { SecurityPolicy } from '@shared/api/security'
import { ApiRequestError, apiClient, readRpcResponse, uploadApiFile } from '@/lib/api'

export const adminQueryKeys = {
  dashboard: ['admin', 'dashboard'] as const,
  applications: ['admin', 'applications'] as const,
  users: ['admin', 'users'] as const,
  connectors: ['admin', 'connectors'] as const,
  signIn: ['admin', 'sign-in-settings'] as const,
  branding: ['admin', 'branding-settings'] as const,
  security: ['admin', 'security-policy'] as const,
  organizations: ['admin', 'organizations'] as const,
  roles: ['admin', 'roles'] as const,
  apiResources: ['admin', 'api-resources'] as const,
  readiness: ['admin', 'readiness'] as const,
}

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
    apiResources,
    signIn,
    security,
  }))
}

export function listApplications() {
  return readRpcResponse(apiClient.api.management.applications.$get())
}

export function createApplication(input: CreateApplicationRequest): Promise<CreateApplicationResponse> {
  return readRpcResponse(apiClient.api.management.applications.$post({ json: input }))
}

export function getApplication(id: string): Promise<ApplicationResponse> {
  return readRpcResponse(apiClient.api.management.applications[':id'].$get({ param: { id } }))
}

export function updateApplication(id: string, input: UpdateApplicationRequest) {
  return readRpcResponse(apiClient.api.management.applications[':id'].$patch({ param: { id }, json: input }))
}

export function deleteApplication(id: string) {
  return readRpcResponse(apiClient.api.management.applications[':id'].$delete({ param: { id } }))
}

export function listApplicationRedirectUris(
  id: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListRedirectUrisResponse> {
  return readRpcResponse(
    apiClient.api.management.applications[':id']['redirect-uris'].$get({
      param: { id },
      query: stringifyQuery(query),
    }),
  )
}

export function replaceApplicationRedirectUris(id: string, input: ReplaceRedirectUrisRequest) {
  return readRpcResponse(
    apiClient.api.management.applications[':id']['redirect-uris'].$put({ param: { id }, json: input }),
  )
}

export function listApplicationClientSecrets(
  id: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListClientSecretsResponse> {
  return readRpcResponse(
    apiClient.api.management.applications[':id']['client-secrets'].$get({
      param: { id },
      query: stringifyQuery(query),
    }),
  )
}

export function rotateApplicationClientSecret(id: string): Promise<RotateClientSecretResponse> {
  return readRpcResponse(apiClient.api.management.applications[':id']['client-secrets'].$post({ param: { id } }))
}

export function uploadApplicationLogo(id: string, file: File): Promise<UploadedAssetResponse> {
  return uploadApiFile(`/api/management/applications/${id}/logo`, file)
}

export function listUsers(query: Partial<ManagementUserListQuery> = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  return readRpcResponse(apiClient.api.management.users.$get({ query: Object.fromEntries(params) }))
}

export function createUser(input: ManagementCreateUserRequest) {
  return readRpcResponse(apiClient.api.management.users.$post({ json: input }))
}

export function updateUser(id: string, input: ManagementUpdateUserRequest) {
  return readRpcResponse(apiClient.api.management.users[':id'].$patch({ param: { id }, json: input }))
}

export function requestPasswordReset(email: string) {
  return readRpcResponse(apiClient.api.management.users['password-reset-requests'].$post({ json: { email } }))
}

export function listConnectors() {
  return readRpcResponse(apiClient.api.management.connectors.$get())
}

export function listConnectorTemplates(): Promise<ListConnectorTemplatesResponse> {
  return readRpcResponse(apiClient.api.management.connectors.templates.$get())
}

export function createConnector(input: CreateManagementConnectorRequest) {
  return readRpcResponse(apiClient.api.management.connectors.$post({ json: input }))
}

export function getConnector(id: string): Promise<ConnectorResponse> {
  return readRpcResponse(apiClient.api.management.connectors[':id'].$get({ param: { id } }))
}

export function updateConnector(id: string, input: UpdateManagementConnectorRequest) {
  return readRpcResponse(apiClient.api.management.connectors[':id'].$patch({ param: { id }, json: input }))
}

export function deleteConnector(id: string) {
  return readRpcResponse(apiClient.api.management.connectors[':id'].$delete({ param: { id } }))
}

export function getConnectorReadiness(id: string): Promise<ConnectorReadinessResponse> {
  return readRpcResponse(apiClient.api.management.connectors[':id'].readiness.$get({ param: { id } }))
}

export function getSignInSettings() {
  return readRpcResponse(apiClient.api.management['sign-in-settings'].$get())
}

export function updateSignInSettings(input: UpdateManagementSignInSettingsRequest) {
  return readRpcResponse(apiClient.api.management['sign-in-settings'].$patch({ json: input }))
}

export function getBrandingSettings(): Promise<ManagementBrandingSettingsResponse> {
  return readRpcResponse(apiClient.api.management['branding-settings'].$get())
}

export function updateBrandingSettings(input: UpdateManagementBrandingSettingsRequest) {
  return readRpcResponse(apiClient.api.management['branding-settings'].$patch({ json: input }))
}

export function getAdminReadiness(): Promise<ManagementReadinessResponse> {
  return readRpcResponse(apiClient.api.management.readiness.$get())
}

export function getSecurityPolicy() {
  return readRpcResponse(apiClient.api.management.security.policy.$get())
}

export function listOrganizations() {
  return readRpcResponse(apiClient.api.management.organizations.$get())
}

export function createOrganization(input: CreateOrganizationRequest) {
  return readRpcResponse(apiClient.api.management.organizations.$post({ json: input }))
}

export function updateOrganization(id: string, input: UpdateOrganizationRequest) {
  return readRpcResponse(apiClient.api.management.organizations[':id'].$patch({ param: { id }, json: input }))
}

export function uploadOrganizationLogo(id: string, file: File): Promise<UploadedAssetResponse> {
  return uploadApiFile(`/api/management/organizations/${id}/logo`, file)
}

export function uploadBrandingLogo(file: File): Promise<UploadedAssetResponse> {
  return uploadApiFile('/api/management/branding/logo', file)
}

export function uploadBrandingFavicon(file: File): Promise<UploadedAssetResponse> {
  return uploadApiFile('/api/management/branding/favicon', file)
}

export function listRoles() {
  return readRpcResponse(apiClient.api.management.roles.$get())
}

export function getRole(id: string): Promise<RoleResponse> {
  return readManagementJson(`/api/management/roles/${id}`)
}

export function createRole(input: CreateRoleRequest) {
  return readRpcResponse(apiClient.api.management.roles.$post({ json: input }))
}

export function updateRole(id: string, input: UpdateRoleRequest) {
  return readRpcResponse(apiClient.api.management.roles[':id'].$patch({ param: { id }, json: input }))
}

export function deleteRole(id: string) {
  return readManagementJson(`/api/management/roles/${id}`, { method: 'DELETE' })
}

export function listRolePermissions(id: string): Promise<RolePermissionsResponse> {
  return readManagementJson(`/api/management/roles/${id}/permissions`)
}

export function replaceRolePermissions(id: string, permissionIds: string[]) {
  return readManagementJson(`/api/management/roles/${id}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissionIds }),
  })
}

export function assignUserRole(input: AssignRoleRequest) {
  return readManagementJson('/api/management/user-role-assignments', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function assignApplicationRole(input: AssignRoleRequest) {
  return readManagementJson('/api/management/application-role-assignments', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function assignMemberRole(input: AssignRoleRequest) {
  return readManagementJson('/api/management/member-role-assignments', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listApiResources() {
  return readRpcResponse(apiClient.api.management['api-resources'].$get())
}

export function getApiResource(id: string): Promise<ApiResourceResponse> {
  return readManagementJson(`/api/management/api-resources/${id}`)
}

export function createApiResource(input: CreateApiResourceRequest) {
  return readRpcResponse(apiClient.api.management['api-resources'].$post({ json: input }))
}

export function updateApiResource(id: string, input: UpdateApiResourceRequest) {
  return readRpcResponse(apiClient.api.management['api-resources'][':id'].$patch({ param: { id }, json: input }))
}

export function deleteApiResource(id: string) {
  return readManagementJson(`/api/management/api-resources/${id}`, { method: 'DELETE' })
}

export function listApiScopes(resourceId: string): Promise<ListApiScopesResponse> {
  return readManagementJson(`/api/management/api-resources/${resourceId}/scopes`)
}

export function createApiScope(resourceId: string, input: CreateApiScopeRequest): Promise<ApiScopeResponse> {
  return readManagementJson(`/api/management/api-resources/${resourceId}/scopes`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateApiScope(
  resourceId: string,
  scopeId: string,
  input: UpdateApiScopeRequest,
): Promise<ApiScopeResponse> {
  return readManagementJson(`/api/management/api-resources/${resourceId}/scopes/${scopeId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteApiScope(resourceId: string, scopeId: string) {
  return readManagementJson(`/api/management/api-resources/${resourceId}/scopes/${scopeId}`, { method: 'DELETE' })
}

export function listApiPermissions(resourceId: string): Promise<ListApiPermissionsResponse> {
  return readManagementJson(`/api/management/api-resources/${resourceId}/permissions`)
}

export function createApiPermission(
  resourceId: string,
  input: CreateApiPermissionRequest,
): Promise<ApiPermissionResponse> {
  return readManagementJson(`/api/management/api-resources/${resourceId}/permissions`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateApiPermission(
  resourceId: string,
  permissionId: string,
  input: UpdateApiPermissionRequest,
): Promise<ApiPermissionResponse> {
  return readManagementJson(`/api/management/api-resources/${resourceId}/permissions/${permissionId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteApiPermission(resourceId: string, permissionId: string) {
  return readManagementJson(`/api/management/api-resources/${resourceId}/permissions/${permissionId}`, {
    method: 'DELETE',
  })
}

function stringifyQuery(query: Partial<PaginationQuery>): Partial<Record<keyof PaginationQuery, string>> {
  return Object.fromEntries(
    Object.entries(query)
      .filter((entry): entry is [keyof PaginationQuery, number] => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )
}

async function readManagementJson<T = void>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
  })
  if (!response.ok) {
    throw new ApiRequestError(await responseMessage(response), response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function responseMessage(response: Pick<Response, 'status' | 'text'>): Promise<string> {
  const text = await response.text()
  if (!text) return `Request failed with status ${response.status}.`

  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string | { message?: string } }
    if (typeof parsed.error === 'string') return parsed.error
    return parsed.message ?? parsed.error?.message ?? text
  } catch {
    return text
  }
}
