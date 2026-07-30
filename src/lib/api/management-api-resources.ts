import type { ApiResource, createApiResourceSchema, updateApiResourceSchema } from '@shared/api/agent-api'
import type { z } from 'zod'
import { apiClient, readJsonResponse, readRpcResponse } from '@/lib/api'

export function listApiResources() {
  return readRpcResponse(apiClient.api['api-resources'].$get())
}

export function getApiResource(id: string): Promise<ApiResource> {
  return readRpcResponse(apiClient.api['api-resources'][':id'].$get({ param: { id } }))
}

export function createApiResource(input: z.input<typeof createApiResourceSchema>) {
  return readRpcResponse(apiClient.api['api-resources'].$post({ json: input }))
}

export function updateApiResource(id: string, input: z.infer<typeof updateApiResourceSchema>) {
  return readRpcResponse(apiClient.api['api-resources'][':id'].$patch({ param: { id }, json: input }))
}

export async function associateApiResourceConnector(id: string, connectorId: string | null): Promise<ApiResource> {
  return readJsonResponse<ApiResource>(
    await fetch(`/api/api-resources/${encodeURIComponent(id)}/authorization-connector`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectorId }),
    }),
  )
}

export function deleteApiResource(id: string) {
  return readRpcResponse(apiClient.api['api-resources'][':id'].$delete({ param: { id } }))
}

export function archiveApiResource(id: string): Promise<ApiResource> {
  return readRpcResponse(apiClient.api['api-resources'][':id'].archival.$put({ param: { id } }))
}

export function restoreApiResource(id: string): Promise<ApiResource> {
  return readRpcResponse(apiClient.api['api-resources'][':id'].archival.$delete({ param: { id } }))
}
