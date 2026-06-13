import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiRequestError } from '@/lib/api/index'
import { createOnboardingAdmin, getOnboardingStatus, readRpcResponse, uploadApiFile } from '@/lib/api/index'

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

  it('prefers structured RPC error messages when present', async () => {
    await expect(
      readRpcResponse(Promise.resolve(jsonResponse({ message: 'Top-level message' }, 422)) as never),
    ).rejects.toMatchObject({
      status: 422,
      message: 'Top-level message',
    } satisfies Partial<ApiRequestError>)
    await expect(
      readRpcResponse(Promise.resolve(jsonResponse({ error: { message: 'Nested message' } }, 423)) as never),
    ).rejects.toMatchObject({
      status: 423,
      message: 'Nested message',
    } satisfies Partial<ApiRequestError>)
    await expect(readRpcResponse(Promise.resolve(jsonResponse({ error: {} }, 424)) as never)).rejects.toMatchObject({
      status: 424,
      message: '{"error":{}}',
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

  it('uploads multipart API files and surfaces upload errors', async () => {
    const responses = [
      jsonResponse({ asset: { id: 'asset-1', publicUrl: '/api/assets/asset-1' } }, 201),
      jsonResponse({ error: { message: 'Unsupported file type.' } }, 400),
    ]
    const fetch = vi.spyOn(window, 'fetch').mockImplementation(() => Promise.resolve(responses.shift()!))

    await expect(uploadApiFile('/api/account/avatar', new File(['avatar'], 'avatar.png'))).resolves.toEqual({
      asset: { id: 'asset-1', publicUrl: '/api/assets/asset-1' },
    })
    expect(fetch).toHaveBeenCalledWith('/api/account/avatar', {
      method: 'POST',
      headers: expect.any(Headers),
      body: expect.any(FormData),
    })
    await expect(uploadApiFile('/api/account/avatar', new File(['svg'], 'avatar.svg'))).rejects.toMatchObject({
      status: 400,
      message: 'Unsupported file type.',
    } satisfies Partial<ApiRequestError>)
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
