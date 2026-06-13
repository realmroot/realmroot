import type { AppType } from '@server/http/app'
import type { HostedConsentApprovalRequest } from '@shared/api/applications'
import type { UploadedAssetResponse } from '@shared/api/assets'
import type { OnboardingAdminRequest } from '@shared/api/onboarding'
import { type ClientResponse, hc } from 'hono/client'

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

export async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new ApiRequestError(await responseMessage(response), response.status)
  }
  return response.json() as Promise<T>
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

export function getOnboardingStatus(): Promise<{ required: boolean }> {
  return readRpcResponse(apiClient.api.onboarding.status.$get())
}

export function createOnboardingAdmin(input: OnboardingAdminRequest): Promise<{
  user: { id: string; email: string; role: string | null }
  onboarding: { locked: true }
}> {
  return readRpcResponse(apiClient.api.onboarding['admin-users'].$post({ json: input }))
}

export function uploadApiFile(path: string, file: File): Promise<UploadedAssetResponse> {
  const form = { file }
  if (path === '/api/account/avatar') return readRpcResponse(apiClient.api.account.avatar.$post({ form }))
  if (path === '/api/management/branding/logo') {
    return readRpcResponse(apiClient.api.management.branding.logo.$post({ form }))
  }
  if (path === '/api/management/branding/favicon') {
    return readRpcResponse(apiClient.api.management.branding.favicon.$post({ form }))
  }
  const applicationLogo = path.match(/^\/api\/management\/applications\/([^/]+)\/logo$/)
  if (applicationLogo) {
    return readRpcResponse(
      apiClient.api.management.applications[':applicationId'].logo.$post({
        param: { applicationId: applicationLogo[1] },
        form,
      }),
    )
  }
  const organizationLogo = path.match(/^\/api\/management\/organizations\/([^/]+)\/logo$/)
  if (organizationLogo) {
    return readRpcResponse(
      apiClient.api.management.organizations[':organizationId'].logo.$post({
        param: { organizationId: organizationLogo[1] },
        form,
      }),
    )
  }
  throw new Error(`Unsupported upload path: ${path}`)
}

function query(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search))
}
