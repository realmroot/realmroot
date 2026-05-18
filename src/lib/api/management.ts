import type {
  ApplicationResponse,
  CreateApplicationRequest,
  ListApplicationsResponse,
  PaginationMetadata,
  UpdateApplicationRequest,
} from '@shared/api/applications'
import type {
  ApiResourceResponse,
  CreateApiResourceRequest,
  CreateOrganizationRequest,
  CreateRoleRequest,
  OrganizationResponse,
  RoleResponse,
  UpdateApiResourceRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
} from '@shared/api/authorization'
import type {
  CreateManagementConnectorRequest,
  ListManagementConnectorsResponse,
  ListManagementUsersResponse,
  ManagementConnectorResponse,
  ManagementCreateUserRequest,
  ManagementSignInSettingsResponse,
  ManagementUpdateUserRequest,
  ManagementUserListQuery,
  ManagementUserResponse,
  UpdateManagementConnectorRequest,
} from '@shared/api/management'
import type { SecurityPolicy } from '@shared/api/security'
import { apiRequest } from '@/lib/api'

const basePath = '/api/management'

export const adminQueryKeys = {
  dashboard: ['admin', 'dashboard'] as const,
  applications: ['admin', 'applications'] as const,
  users: ['admin', 'users'] as const,
  connectors: ['admin', 'connectors'] as const,
  signIn: ['admin', 'sign-in-settings'] as const,
  security: ['admin', 'security-policy'] as const,
  organizations: ['admin', 'organizations'] as const,
  roles: ['admin', 'roles'] as const,
  apiResources: ['admin', 'api-resources'] as const,
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
  return apiRequest<ListApplicationsResponse>(`${basePath}/applications`)
}

export function createApplication(input: CreateApplicationRequest) {
  return apiRequest<ApplicationResponse>(`${basePath}/applications`, { method: 'POST', body: input })
}

export function updateApplication(id: string, input: UpdateApplicationRequest) {
  return apiRequest<ApplicationResponse>(`${basePath}/applications/${id}`, { method: 'PATCH', body: input })
}

export function listUsers(query: Partial<ManagementUserListQuery> = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const search = params.toString()
  return apiRequest<ListManagementUsersResponse>(`${basePath}/users${search ? `?${search}` : ''}`)
}

export function createUser(input: ManagementCreateUserRequest) {
  return apiRequest<ManagementUserResponse>(`${basePath}/users`, { method: 'POST', body: input })
}

export function updateUser(id: string, input: ManagementUpdateUserRequest) {
  return apiRequest<{ user: ManagementUserResponse }>(`${basePath}/users/${id}`, { method: 'PATCH', body: input })
}

export function requestPasswordReset(email: string) {
  return apiRequest<unknown>(`${basePath}/users/password-reset-requests`, { method: 'POST', body: { email } })
}

export function listConnectors() {
  return apiRequest<ListManagementConnectorsResponse>(`${basePath}/connectors`)
}

export function createConnector(input: CreateManagementConnectorRequest) {
  return apiRequest<ManagementConnectorResponse>(`${basePath}/connectors`, { method: 'POST', body: input })
}

export function updateConnector(id: string, input: UpdateManagementConnectorRequest) {
  return apiRequest<ManagementConnectorResponse>(`${basePath}/connectors/${id}`, { method: 'PATCH', body: input })
}

export function getSignInSettings() {
  return apiRequest<ManagementSignInSettingsResponse>(`${basePath}/sign-in-settings`)
}

export function getSecurityPolicy() {
  return apiRequest<{ policy: SecurityPolicy }>(`${basePath}/security/policy`)
}

export function listOrganizations() {
  return apiRequest<ListOrganizationsResponse>(`${basePath}/organizations`)
}

export function createOrganization(input: CreateOrganizationRequest) {
  return apiRequest<OrganizationResponse>(`${basePath}/organizations`, { method: 'POST', body: input })
}

export function updateOrganization(id: string, input: UpdateOrganizationRequest) {
  return apiRequest<OrganizationResponse>(`${basePath}/organizations/${id}`, { method: 'PATCH', body: input })
}

export function listRoles() {
  return apiRequest<ListRolesResponse>(`${basePath}/roles`)
}

export function createRole(input: CreateRoleRequest) {
  return apiRequest<RoleResponse>(`${basePath}/roles`, { method: 'POST', body: input })
}

export function updateRole(id: string, input: UpdateRoleRequest) {
  return apiRequest<RoleResponse>(`${basePath}/roles/${id}`, { method: 'PATCH', body: input })
}

export function listApiResources() {
  return apiRequest<ListApiResourcesResponse>(`${basePath}/api-resources`)
}

export function createApiResource(input: CreateApiResourceRequest) {
  return apiRequest<ApiResourceResponse>(`${basePath}/api-resources`, { method: 'POST', body: input })
}

export function updateApiResource(id: string, input: UpdateApiResourceRequest) {
  return apiRequest<ApiResourceResponse>(`${basePath}/api-resources/${id}`, { method: 'PATCH', body: input })
}
