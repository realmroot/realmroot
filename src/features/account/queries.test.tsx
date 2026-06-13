import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAccountServer, createAccountStore } from './account.test-utils'
import {
  useAccountAgents,
  useAccountConfig,
  useAccountMutation,
  useAccountPasskeys,
  useAccountProfile,
  useAccountSecurity,
  useAccountSessions,
  useConsentedApplications,
  useLinkedAccounts,
} from './queries'

const success = vi.fn()
const error = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => error(...args),
  },
}))

const store = createAccountStore()
const server = createAccountServer(store)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  success.mockClear()
  error.mockClear()
})
afterAll(() => server.close())

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('account query hooks', () => {
  it('loads config and profile data', async () => {
    const client = newClient()
    const config = renderHook(() => useAccountConfig(), { wrapper: wrapper(client) })
    const profile = renderHook(() => useAccountProfile(), { wrapper: wrapper(client) })
    await waitFor(() => expect(config.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(profile.result.current.isSuccess).toBe(true))
    expect(config.result.current.data?.copy.productName).toBe('FlareAuth')
    expect(profile.result.current.data?.user.email).toBe('jane@example.com')
  })

  it('loads security and passkeys', async () => {
    const client = newClient()
    const security = renderHook(() => useAccountSecurity(), { wrapper: wrapper(client) })
    const passkeys = renderHook(() => useAccountPasskeys(), { wrapper: wrapper(client) })
    await waitFor(() => expect(security.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(passkeys.result.current.isSuccess).toBe(true))
    expect(security.result.current.data?.security.passkeys.enabled).toBe(true)
    expect(passkeys.result.current.data?.passkeys).toEqual([])
  })

  it('respects the enabled flag for gated queries', async () => {
    const client = newClient()
    const disabled = renderHook(() => useAccountSessions(false), { wrapper: wrapper(client) })
    expect(disabled.result.current.fetchStatus).toBe('idle')

    const enabled = renderHook(() => useAccountSessions(true), { wrapper: wrapper(client) })
    await waitFor(() => expect(enabled.result.current.isSuccess).toBe(true))

    const linked = renderHook(() => useLinkedAccounts(true), { wrapper: wrapper(client) })
    const apps = renderHook(() => useConsentedApplications(true), { wrapper: wrapper(client) })
    const agents = renderHook(() => useAccountAgents(), { wrapper: wrapper(client) })
    await waitFor(() => expect(linked.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(apps.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(agents.result.current.isSuccess).toBe(true))
  })
})

describe('useAccountMutation', () => {
  it('reports success, invalidates queries, and returns the result', async () => {
    const client = newClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAccountMutation(), { wrapper: wrapper(client) })

    const value = await result.current('Saved.', async () => ({ ok: true }), {
      invalidate: [['account', 'profile']],
    })

    expect(value).toEqual({ ok: true })
    expect(success).toHaveBeenCalledWith('Saved.')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['account', 'profile'] })
  })

  it('reports an error message and calls the onError callback', async () => {
    const client = newClient()
    const onError = vi.fn()
    const { result } = renderHook(() => useAccountMutation(), { wrapper: wrapper(client) })

    const value = await result.current(
      'Saved.',
      async () => {
        throw new Error('Specific failure.')
      },
      { onError },
    )

    expect(value).toBeUndefined()
    expect(onError).toHaveBeenCalledWith('Specific failure.')
    expect(error).toHaveBeenCalledWith('Specific failure.')
    expect(success).not.toHaveBeenCalled()
  })

  it('falls back to a generic message for non-Error throws', async () => {
    const client = newClient()
    const { result } = renderHook(() => useAccountMutation(), { wrapper: wrapper(client) })

    const value = await result.current('Saved.', async () => {
      throw 'string failure'
    })

    expect(value).toBeUndefined()
    expect(error).toHaveBeenCalledWith('Account update failed.')
  })
})
