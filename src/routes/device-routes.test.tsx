import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routeTree } from '@/routeTree.gen'

vi.mock('@/components/layout/auth-layout', () => ({
  AuthLayout: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}))

vi.mock('@/features/auth/device-authorization', () => ({
  DeviceVerification: ({ userCode }: { userCode?: string }) => <div>Device verification {userCode}</div>,
}))

vi.mock('@/features/auth/hooks', () => ({
  useConfigz: () => ({ data: null }),
}))

// The protected approval layout is gated on a signed-in profile; let it through
// so the test exercises rendering, not auth.
vi.mock('@/lib/route-auth', () => ({
  requireAccountProfile: vi.fn(async () => ({ id: 'user-test' })),
}))

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

// Drives the real route tree rather than isolated route components.
// The device components read the user code from window.location, so mirror the
// path there too (memory history alone does not update window.location).
async function renderRouteAt(path: string) {
  window.history.pushState(null, '', path)
  const router = createRouter({
    context: { queryClient: new QueryClient() },
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByText(/Device verification/)
}

describe('device routes', () => {
  it('renders device code entry at /auth/device', async () => {
    await renderRouteAt('/auth/device')

    expect(screen.getByRole('heading', { name: 'Connect a device' })).toBeTruthy()
    expect(screen.getByText('Device verification')).toBeTruthy()
  })

  it('renders a supplied device code through the protected layout', async () => {
    await renderRouteAt('/auth/device?user_code=ABCD-1234')

    expect(screen.getByRole('heading', { name: 'Connect a device' })).toBeTruthy()
    expect(screen.getByText('Device verification ABCD-1234')).toBeTruthy()
  })
})
