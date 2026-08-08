import type { PublicAgentResponse, PublicUserResponse } from '@shared/api/public-profiles'
import { readJsonResponse } from '@/lib/api'

export async function getPublicUserProfile(username: string): Promise<PublicUserResponse> {
  return readJsonResponse(
    await fetch(`/api/public/users/${encodeURIComponent(username)}?view=full`, {
      headers: { accept: 'application/json' },
    }),
  )
}

export async function getPublicAgentProfile(subject: string): Promise<PublicAgentResponse> {
  return readJsonResponse(
    await fetch(`/api/public/agents/${encodeURIComponent(subject)}?view=full`, {
      headers: { accept: 'application/json' },
    }),
  )
}
