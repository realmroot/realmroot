import type {
  ApiPermissionResponse,
  ApiResourceResponse,
  ApiScopeResponse,
  CreateApiPermissionRequest,
  CreateApiResourceRequest,
  CreateApiScopeRequest,
  ListApiPermissionsResponse,
  ListApiScopesResponse,
  UpdateApiPermissionRequest,
  UpdateApiResourceRequest,
  UpdateApiScopeRequest,
} from '@shared/api/authorization'
import type { ConfigureExternalResourceAuthorizationRequest } from '@shared/api/external-resources'
import { externalResourceAuthorizationSchema } from '@shared/api/external-resources'
import { apiClient, readRpcResponse } from '@/lib/api'

export function listApiResources() {
  return readRpcResponse(apiClient.api.management['api-resources'].$get())
}

export function getApiResource(id: string): Promise<ApiResourceResponse> {
  return readRpcResponse(apiClient.api.management['api-resources'][':id'].$get({ param: { id } }))
}

export function createApiResource(input: CreateApiResourceRequest) {
  return readRpcResponse(apiClient.api.management['api-resources'].$post({ json: input }))
}

export function updateApiResource(id: string, input: UpdateApiResourceRequest) {
  return readRpcResponse(apiClient.api.management['api-resources'][':id'].$patch({ param: { id }, json: input }))
}

export function deleteApiResource(id: string) {
  return readRpcResponse(apiClient.api.management['api-resources'][':id'].$delete({ param: { id } }))
}

export function getExternalApiResourceAuthorization(resourceId: string) {
  return readRpcResponse(
    apiClient.api.management['api-resources'][':id']['external-authorization'].$get({
      param: { id: resourceId },
    }),
  ).then((value) => externalResourceAuthorizationSchema.parse(value))
}

export function configureExternalApiResourceAuthorization(
  resourceId: string,
  input: ConfigureExternalResourceAuthorizationRequest,
) {
  return readRpcResponse(
    apiClient.api.management['api-resources'][':id']['external-authorization'].$put({
      param: { id: resourceId },
      json: input,
    }),
  ).then((value) => externalResourceAuthorizationSchema.parse(value))
}

export function listApiScopes(resourceId: string): Promise<ListApiScopesResponse> {
  return readRpcResponse(apiClient.api.management['api-resources'][':id'].scopes.$get({ param: { id: resourceId } }))
}

export function createApiScope(resourceId: string, input: CreateApiScopeRequest): Promise<ApiScopeResponse> {
  return readRpcResponse(
    apiClient.api.management['api-resources'][':id'].scopes.$post({ param: { id: resourceId }, json: input }),
  )
}

export function updateApiScope(
  resourceId: string,
  scopeId: string,
  input: UpdateApiScopeRequest,
): Promise<ApiScopeResponse> {
  return readRpcResponse(
    apiClient.api.management['api-resources'][':id'].scopes[':scopeId'].$patch({
      param: { id: resourceId, scopeId },
      json: input,
    }),
  )
}

export function deleteApiScope(resourceId: string, scopeId: string) {
  return readRpcResponse(
    apiClient.api.management['api-resources'][':id'].scopes[':scopeId'].$delete({
      param: { id: resourceId, scopeId },
    }),
  )
}

export function listApiPermissions(resourceId: string): Promise<ListApiPermissionsResponse> {
  return readRpcResponse(
    apiClient.api.management['api-resources'][':id'].permissions.$get({ param: { id: resourceId } }),
  )
}

export function createApiPermission(
  resourceId: string,
  input: CreateApiPermissionRequest,
): Promise<ApiPermissionResponse> {
  return readRpcResponse(
    apiClient.api.management['api-resources'][':id'].permissions.$post({ param: { id: resourceId }, json: input }),
  )
}

export function updateApiPermission(
  resourceId: string,
  permissionId: string,
  input: UpdateApiPermissionRequest,
): Promise<ApiPermissionResponse> {
  return readRpcResponse(
    apiClient.api.management['api-resources'][':id'].permissions[':permissionId'].$patch({
      param: { id: resourceId, permissionId },
      json: input,
    }),
  )
}

export function deleteApiPermission(resourceId: string, permissionId: string) {
  return readRpcResponse(
    apiClient.api.management['api-resources'][':id'].permissions[':permissionId'].$delete({
      param: { id: resourceId, permissionId },
    }),
  )
}
