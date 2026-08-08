import {
  type PublicAgentResponse,
  type PublicUserResponse,
  publicAgentResponseSchema,
  publicUserResponseSchema,
} from '@shared/api/public-profiles'
import { readJsonResponse } from '@/lib/api'

export async function getPublicUserProfile(username: string): Promise<PublicUserResponse> {
  return publicUserResponseSchema.parse(
    await readJsonResponse<unknown>(
      await fetch(`/api/public/users/${encodeURIComponent(username)}?view=full`, {
        headers: { accept: 'application/json' },
      }),
    ),
  )
}

export async function getPublicAgentProfile(subject: string): Promise<PublicAgentResponse> {
  return publicAgentResponseSchema.parse(
    await readJsonResponse<unknown>(
      await fetch(`/api/public/agents/${encodeURIComponent(subject)}?view=full`, {
        headers: { accept: 'application/json' },
      }),
    ),
  )
}
