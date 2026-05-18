import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiRequestError } from './index'
import { createOnboardingAdmin, getOnboardingStatus, readRpcResponse } from './index'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('onboarding API client', () => {
  it('reads RPC success responses including empty 204 bodies', async () => {
    await expect(readRpcResponse(Promise.resolve(jsonResponse({ ok: true })) as never)).resolves.toEqual({ ok: true })
    await expect(
      readRpcResponse(Promise.resolve(new Response(null, { status: 204 })) as never),
    ).resolves.toBeUndefined()
  })

  it('uses RPC error message fallbacks for empty and non-JSON bodies', async () => {
    await expect(readRpcResponse(Promise.resolve(new Response('', { status: 500 })) as never)).rejects.toMatchObject({
      status: 500,
      message: 'Request failed with status 500.',
    } satisfies Partial<ApiRequestError>)
    await expect(
      readRpcResponse(Promise.resolve(new Response('plain failure', { status: 502 })) as never),
    ).rejects.toMatchObject({
      status: 502,
      message: 'plain failure',
    } satisfies Partial<ApiRequestError>)
  })

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
