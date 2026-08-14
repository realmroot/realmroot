import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routeTree } from '@/routeTree.gen'

const auth = vi.hoisted(() => ({
  consoleAccessRequest: vi.fn(async () => ({ platformOperator: true })),
  profileRequest: vi.fn(async () => ({ user: { id: 'user-1' } })),
}))

vi.mock('@/lib/route-auth', () => ({
  loadCachedDeveloperConsoleAccess: (queryClient: QueryClient) =>
    queryClient.fetchQuery({
      queryFn: auth.consoleAccessRequest,
      queryKey: ['account', 'developer-console-access'],
      staleTime: 60_000,
    }),
  requireAccountProfile: (_href: string, queryClient: QueryClient) =>
    queryClient.fetchQuery({
      queryFn: auth.profileRequest,
      queryKey: ['account', 'profile'],
      staleTime: 60_000,
    }),
}))

beforeEach(() => {
  auth.consoleAccessRequest.mockReset().mockResolvedValue({ platformOperator: true })
  auth.profileRequest.mockReset().mockResolvedValue({ user: { id: 'user-1' } })
})

describe('router authentication boundaries', () => {
  it('owns authentication at the protected route layouts', () => {
    const router = createTestRouter('/profile')

    expect(router.routesById['/_account'].options.beforeLoad).toBeTypeOf('function')
    expect(router.routesById['/console'].options.beforeLoad).toBeTypeOf('function')
    expect(router.routesById['/agent'].options.beforeLoad).toBeTypeOf('function')
    expect(router.routesById['/auth/_protected'].options.beforeLoad).toBeTypeOf('function')

    for (const routeId of [
      '/_account/profile',
      '/_account/security',
      '/_account/connections',
      '/_account/organizations/',
      '/agent/enrollment',
      '/auth/_protected/device',
    ] as const) {
      expect(router.routesById[routeId].options.beforeLoad).toBeUndefined()
    }
  })

  it('does not register removed Console compatibility aliases', () => {
    const routes = createTestRouter('/console').routesById as unknown as Record<string, unknown>

    for (const routeId of [
      '/console/customize-jwt',
      '/console/mfa',
      '/console/applications/$applicationId/branding',
      '/console/applications/$applicationId/federated-credentials',
      '/console/sign-in-experience/branding',
      '/console/sign-in-experience/sign-up-and-sign-in',
      '/console/security/general',
      '/console/security/captcha',
      '/console/security/blocklist',
      '/console/tenant-settings/oidc-configs',
      '/console/organization-template/',
      '/console/roles/',
      '/console/organizations/$organizationId',
    ]) {
      expect(routes[routeId]).toBeUndefined()
    }
    expect(routes['/console/sign-in-experience/account-center']).toBeTruthy()
    expect(routes['/console/sign-in-experience/content']).toBeTruthy()
  })

  it('does not repeat authentication requests while navigating protected routes', async () => {
    const router = createTestRouter('/profile')

    await router.load()
    expect(auth.profileRequest).toHaveBeenCalledTimes(1)

    await router.navigate({ to: '/security' })
    await router.navigate({ to: '/organizations' })
    expect(auth.profileRequest).toHaveBeenCalledTimes(1)

    await router.navigate({ to: '/console/security/sign-in' })
    await router.navigate({ to: '/console/security/mfa' })
    expect(auth.profileRequest).toHaveBeenCalledTimes(1)
    expect(auth.consoleAccessRequest).toHaveBeenCalledTimes(1)

    await router.navigate({ to: '/agent/enrollment' })
    await router.navigate({ to: '/auth/device', search: { user_code: '' } })
    expect(auth.profileRequest).toHaveBeenCalledTimes(1)
  })

  it('checks the account session before requesting Console authorization', async () => {
    let resolveProfile: (profile: { user: { id: string } }) => void = () => undefined
    auth.profileRequest.mockImplementationOnce(() => new Promise((resolve) => (resolveProfile = resolve)))
    const router = createTestRouter('/console')

    const loading = router.load()
    await Promise.resolve()
    expect(auth.consoleAccessRequest).not.toHaveBeenCalled()

    resolveProfile({ user: { id: 'user-1' } })
    await loading
    expect(auth.consoleAccessRequest).toHaveBeenCalledTimes(1)
  })
})

function createTestRouter(initialEntry: string) {
  return createRouter({
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    routeTree,
  })
}
