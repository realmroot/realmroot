import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiRequestError } from './index'
import { createOnboardingAdmin, getOnboardingStatus } from './index'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('onboarding API client', () => {
  it('surfaces onboarding status boundary errors', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ error: { message: 'Unavailable' } }, 503))

    await expect(getOnboardingStatus()).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 503,
      message: 'Unavailable',
    } satisfies Partial<ApiRequestError>)
  })

  it('surfaces first-admin creation boundary errors', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ error: 'Already initialized' }, 409))

    await expect(
      createOnboardingAdmin({
        email: 'admin@example.com',
        name: 'Admin User',
        password: 'password-1',
        username: 'admin',
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Already initialized',
    } satisfies Partial<ApiRequestError>)
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
