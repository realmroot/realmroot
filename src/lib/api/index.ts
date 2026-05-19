import type { HostedConsentApprovalRequest } from '@shared/api/applications'
import type { UploadedAssetResponse } from '@shared/api/assets'
import type { OnboardingAdminRequest } from '@shared/api/onboarding'
import { type ClientResponse, hc } from 'hono/client'
import type { AppType } from '../../../server/app'

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export const apiClient = hc<AppType>('/')

type SuccessResponseBody<RpcRequest> =
  RpcRequest extends Promise<infer Response>
    ? Response extends ClientResponse<infer Body, infer Status, string>
      ? Status extends 400
        ? never
        : Body
      : never
    : never

export async function readRpcResponse<RpcRequest extends Promise<ClientResponse<unknown, number, string>>>(
  request: RpcRequest,
): Promise<SuccessResponseBody<RpcRequest>> {
  const response = await request
  if (!response.ok) {
    throw new ApiRequestError(await responseMessage(response), response.status)
  }

  if (response.status === 204) return undefined as SuccessResponseBody<RpcRequest>

  return (await response.json()) as SuccessResponseBody<RpcRequest>
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

export function getPlatformStatus() {
  return readRpcResponse(apiClient.api.health.$get())
}

export function getConfigz() {
  return readRpcResponse(apiClient.api.configz.$get())
}

export function getConsentRequest(search: string) {
  return readRpcResponse(
    apiClient.api.oauth.consent.$get({
      query: query(search) as { client_id: string; redirect_uri: string; scope?: string; state?: string },
    }),
  )
}

export function createConsent(input: HostedConsentApprovalRequest) {
  return readRpcResponse(apiClient.api.oauth.consent.$post({ json: input }))
}

export async function getOnboardingStatus(): Promise<{ required: boolean }> {
  const response = await fetch('/api/onboarding/status')
  if (!response.ok) {
    throw new ApiRequestError(await responseMessage(response), response.status)
  }
  return response.json() as Promise<{ required: boolean }>
}

export async function createOnboardingAdmin(input: OnboardingAdminRequest) {
  const response = await fetch('/api/onboarding/admin-users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new ApiRequestError(await responseMessage(response), response.status)
  }
  return response.json() as Promise<{
    user: { id: string; email: string; role: string | null }
    onboarding: { locked: true }
  }>
}

export async function uploadApiFile(path: string, file: File): Promise<UploadedAssetResponse> {
  const body = new FormData()
  body.set('file', file)

  const response = await fetch(path, {
    method: 'POST',
    body,
  })
  if (!response.ok) {
    throw new ApiRequestError(await responseMessage(response), response.status)
  }
  return response.json() as Promise<UploadedAssetResponse>
}

function query(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search))
}
