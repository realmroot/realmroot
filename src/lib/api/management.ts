import type {
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
  ManagementCreateUserRequest,
  ManagementSignInSettingsResponse,
  ManagementUpdateUserRequest,
  ManagementUserListQuery,
  UpdateManagementConnectorRequest,
} from '@shared/api/management'
import type { SecurityPolicy } from '@shared/api/security'
import { apiClient, readRpcResponse } from '@/lib/api'

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
  return readRpcResponse(apiClient.api.management.applications.$get())
}

export function createApplication(input: CreateApplicationRequest) {
  return readRpcResponse(apiClient.api.management.applications.$post({ json: input }))
}

export function updateApplication(id: string, input: UpdateApplicationRequest) {
  return readRpcResponse(apiClient.api.management.applications[':id'].$patch({ param: { id }, json: input }))
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

export function createConnector(input: CreateManagementConnectorRequest) {
  return readRpcResponse(apiClient.api.management.connectors.$post({ json: input }))
}

export function updateConnector(id: string, input: UpdateManagementConnectorRequest) {
  return readRpcResponse(apiClient.api.management.connectors[':id'].$patch({ param: { id }, json: input }))
}

export function getSignInSettings() {
  return readRpcResponse(apiClient.api.management['sign-in-settings'].$get())
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

export function listRoles() {
  return readRpcResponse(apiClient.api.management.roles.$get())
}

export function createRole(input: CreateRoleRequest) {
  return readRpcResponse(apiClient.api.management.roles.$post({ json: input }))
}

export function updateRole(id: string, input: UpdateRoleRequest) {
  return readRpcResponse(apiClient.api.management.roles[':id'].$patch({ param: { id }, json: input }))
}

export function listApiResources() {
  return readRpcResponse(apiClient.api.management['api-resources'].$get())
}

export function createApiResource(input: CreateApiResourceRequest) {
  return readRpcResponse(apiClient.api.management['api-resources'].$post({ json: input }))
}

export function updateApiResource(id: string, input: UpdateApiResourceRequest) {
  return readRpcResponse(apiClient.api.management['api-resources'][':id'].$patch({ param: { id }, json: input }))
}
