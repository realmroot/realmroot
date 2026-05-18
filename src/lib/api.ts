import type { ConsentRequestResponse, HostedConsentApprovalRequest } from '@shared/api/applications'
import type { ExperienceCallbackResponse, ExperienceConfigResponse } from '@shared/api/experience'

type RequestOptions = {
  method?: string
  body?: unknown
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (!response.ok) {
    throw new Error(await responseMessage(response))
  }

  return (await response.json()) as T
}

async function responseMessage(response: Response): Promise<string> {
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

export function getExperienceConfig() {
  return apiRequest<ExperienceConfigResponse>('/api/experience')
}

export function getCallbackState(search: string) {
  return apiRequest<ExperienceCallbackResponse>(`/api/experience/callback${search}`)
}

export function getConsentRequest(search: string) {
  return apiRequest<ConsentRequestResponse>(`/api/oauth/consent${search}`)
}

export function createConsent(input: HostedConsentApprovalRequest) {
  return apiRequest<{ consent: { id: string; scopes: string[]; grantedAt: string } }>('/api/oauth/consent', {
    method: 'POST',
    body: input,
  })
}
