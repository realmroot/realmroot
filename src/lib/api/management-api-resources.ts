import type { ApiResource, createApiResourceSchema, updateApiResourceSchema } from '@shared/api/agent-api'
import type { ListApiResourcesQuery } from '@shared/api/authorization'
import type { z } from 'zod'
import { apiClient, readJsonResponse, readRpcResponse } from '@/lib/api'

export function listApiResources(query: Partial<ListApiResourcesQuery> = {}) {
  const serialized = Object.fromEntries(
    Object.entries(query).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  return readRpcResponse(
    Object.keys(serialized).length === 0
      ? apiClient.api['resource-servers'].$get()
      : apiClient.api['resource-servers'].$get({ query: serialized }),
  )
}

export function getApiResource(id: string): Promise<ApiResource> {
  return readRpcResponse(apiClient.api['resource-servers'][':id'].$get({ param: { id } }))
}

export function createApiResource(input: z.input<typeof createApiResourceSchema>) {
  return readRpcResponse(apiClient.api['resource-servers'].$post({ json: input }))
}

export function updateApiResource(id: string, input: z.infer<typeof updateApiResourceSchema>) {
  return readRpcResponse(apiClient.api['resource-servers'][':id'].$patch({ param: { id }, json: input }))
}

export function refreshApiResourceScopeRegistry(id: string): Promise<ApiResource> {
  return fetch(`/api/resource-servers/${encodeURIComponent(id)}/scope-registry`, {
    method: 'PUT',
    credentials: 'same-origin',
  }).then((response) => readJsonResponse<ApiResource>(response))
}

export function deleteApiResource(id: string) {
  return readRpcResponse(apiClient.api['resource-servers'][':id'].$delete({ param: { id } }))
}
