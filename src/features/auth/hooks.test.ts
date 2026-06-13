import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callbackURL, safeRedirectPath, useConfigz } from '@/features/auth/hooks'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('useConfigz', () => {
  it('exposes the loaded configuration when the request succeeds', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ copy: { productName: 'Acme ID' } }))

    const { result } = renderHook(() => useConfigz())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toMatchObject({ copy: { productName: 'Acme ID' } })
    expect(result.current.error).toBeNull()
  })

  it('surfaces the error message when the request fails', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ error: 'Service unavailable.' }, 503))

    const { result } = renderHook(() => useConfigz())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('Service unavailable.')
  })

  it('falls back to a generic message for non-Error rejections', async () => {
    vi.spyOn(window, 'fetch').mockRejectedValue('boom')

    const { result } = renderHook(() => useConfigz())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Unable to load.')
  })

  it('ignores resolution after unmount', async () => {
    let resolveFetch: ((value: Response) => void) | undefined
    vi.spyOn(window, 'fetch').mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    const { result, unmount } = renderHook(() => useConfigz())
    unmount()
    resolveFetch?.(jsonResponse({ copy: { productName: 'Acme ID' } }))

    expect(result.current.loading).toBe(true)
  })
})

describe('auth callback URL resolution', () => {
  it('returns the provider authorize endpoint for OAuth authorize query parameters', () => {
    window.history.pushState(
      null,
      '',
      '/auth/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )

    expect(callbackURL()).toBe(
      '/api/auth/oauth2/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
  })

  it('uses explicit hosted callback parameters for non-OAuth flows', () => {
    window.history.pushState(
      null,
      '',
      '/auth/sign-in?callbackURL=%2Fprofile&redirect_uri=https%3A%2F%2Fclient.example.com',
    )

    expect(callbackURL()).toBe('/profile')
  })

  it('rejects unsafe hosted callback paths', () => {
    window.history.pushState(
      null,
      '',
      '/auth/sign-in?callbackURL=https%3A%2F%2Fclient.example.com&return_to=%2F%2Fevil.example',
    )

    expect(callbackURL()).toBeUndefined()
    expect(safeRedirectPath('/api/account')).toBeUndefined()
    expect(safeRedirectPath('/api/auth/oauth2/authorize?client_id=client-1')).toBe(
      '/api/auth/oauth2/authorize?client_id=client-1',
    )
  })
})
