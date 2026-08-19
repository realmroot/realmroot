import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { base, createAccountServer, createAccountStore, http, json } from './account.test-utils'
import {
  useAccountAgents,
  useAccountApplicationAuthorizations,
  useAccountConfig,
  useAccountMutation,
  useAccountOrganizationTeamMembers,
  useAccountOrganizationTeams,
  useAccountPasskeys,
  useAccountProfile,
  useAccountSecurity,
  useAccountSessions,
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
    expect(config.result.current.data?.copy.productName).toBe('Realmroot')
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
    const apps = renderHook(() => useAccountApplicationAuthorizations(true), { wrapper: wrapper(client) })
    const agents = renderHook(() => useAccountAgents(), { wrapper: wrapper(client) })
    await waitFor(() => expect(linked.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(apps.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(agents.result.current.isSuccess).toBe(true))
  })

  it('loads Organization Teams and gates Team members until a Team is selected', async () => {
    server.use(
      http.get(`${base}/api/auth/organization/list-teams`, () =>
        json([{ id: 'team-1', name: 'platform-admins', organizationId: 'org-1' }]),
      ),
      http.get(`${base}/api/account/organizations/org-1/teams/team-1/members`, ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset'))
        const items = Array.from({ length: offset === 0 ? 100 : 1 }, (_, index) => ({
          id: `membership-${offset + index + 1}`,
          teamId: 'team-1',
          userId: `user-${offset + index + 1}`,
          createdAt: '2026-08-01T00:00:00Z',
        }))
        return json({
          items,
          pagination: {
            limit: 100,
            offset,
            total: 101,
            hasMore: offset === 0,
            nextOffset: offset === 0 ? 100 : null,
          },
        })
      }),
    )
    const client = newClient()
    const teams = renderHook(() => useAccountOrganizationTeams('org-1'), { wrapper: wrapper(client) })
    const disabledMembers = renderHook(() => useAccountOrganizationTeamMembers('org-1', null), {
      wrapper: wrapper(client),
    })
    expect(disabledMembers.result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(teams.result.current.data?.[0]?.name).toBe('platform-admins'))

    const members = renderHook(() => useAccountOrganizationTeamMembers('org-1', 'team-1'), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(members.result.current.data).toHaveLength(101))
    expect(members.result.current.data?.[100]?.userId).toBe('user-101')
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

  it('can invalidate a collection without refetching active detail queries', async () => {
    const client = newClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAccountMutation(), { wrapper: wrapper(client) })

    await result.current('Organization deleted.', async () => undefined, {
      invalidateExact: [['account', 'organizations']],
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ exact: true, queryKey: ['account', 'organizations'] })
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
