import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleShell } from '@/components/layout/console-shell'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
Element.prototype.scrollIntoView ??= () => {}

const profile = {
  id: 'user-1',
  email: 'admin@example.com',
  emailVerified: true,
  displayName: 'Realmroot Admin',
  username: 'admin',
  avatarAssetId: null,
  image: null,
  bio: null,
  location: null,
  links: [],
  role: 'admin',
}
function TestConsoleShell({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ConsoleShell profile={profile}>{children}</ConsoleShell>
    </QueryClientProvider>
  )
}

let pathname = '/console'
const queryClient = new QueryClient()
const signOut = vi.fn().mockResolvedValue({})
const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    'aria-current': ariaCurrent,
    'aria-label': ariaLabel,
    children,
    className,
    onClick,
    params,
    to,
  }: {
    'aria-current'?: 'page'
    'aria-label'?: string
    children: ReactNode
    className?: string
    onClick?: () => void
    params?: Record<string, string>
    to: string
  }) => (
    <a
      aria-current={ariaCurrent}
      aria-label={ariaLabel}
      className={className}
      href={Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)}
      onClick={onClick}
    >
      {children}
    </a>
  ),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname } }),
  useNavigate: () => navigate,
}))

vi.mock('@/lib/auth-client', () => ({
  signOut: () => signOut(),
}))

afterEach(() => {
  cleanup()
  pathname = '/console'
  navigate.mockClear()
  signOut.mockClear()
  queryClient.clear()
  window.history.pushState(null, '', '/')
})

describe('ConsoleShell', () => {
  it('renders Console navigation and marks the exact dashboard route active', () => {
    render(<TestConsoleShell>Dashboard content</TestConsoleShell>)

    expect(screen.getAllByText('Console').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Switch organization' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Account menu' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Account center/i })).toBeNull()
    expect(screen.getByText('Dashboard content')).toBeTruthy()
    expect(screen.getByText('Dashboard content').closest('.consoleShell')).toBeTruthy()
    expect(document.querySelector('header')?.className).toContain('consoleTopbar')
    expect(document.querySelector('header')?.className).not.toContain('lg:hidden')
    expect(document.querySelector('aside')?.className).toContain('consoleRail')
    expect(document.querySelector('main')?.className).toContain('consoleMain')
    expect(screen.getByText('Dashboard content').closest('.consoleContent')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].getAttribute('aria-current')).toBe('page')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).toContain('is-active')
    expect(screen.getAllByRole('link', { name: /Applications/ })[0].className).not.toContain('is-active')
    expect(screen.getAllByRole('link', { name: 'API Documentation' })[0].getAttribute('href')).toBe('/api/docs')
    expect(screen.queryByText('Tenant health')).toBeNull()
    expect(screen.queryByText('OIDC clients')).toBeNull()
    expect(screen.queryByRole('link', { name: /Onboarding/ })).toBeNull()
  })

  it('searches and opens a Console page [spec: admin-console/admin-route-backed-navigation]', async () => {
    render(<TestConsoleShell>Dashboard content</TestConsoleShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Search Console' }))
    fireEvent.change(await screen.findByPlaceholderText('Search Console…'), { target: { value: 'applications' } })
    fireEvent.click(await screen.findByRole('option', { name: /Applications/ }))

    expect(navigate).toHaveBeenCalledWith({ to: '/console/applications' })
    expect(screen.queryByPlaceholderText('Search Console…')).toBeNull()
  })

  it('opens the account menu with shell-local actions', async () => {
    render(<TestConsoleShell>Dashboard content</TestConsoleShell>)

    fireEvent.pointerDown(screen.getAllByRole('button', { name: 'Account menu' })[0], {
      button: 0,
      ctrlKey: false,
    })

    expect(await screen.findByText('Realmroot Admin')).toBeTruthy()
    expect(screen.getByText('admin@example.com')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View public profile for Realmroot Admin' }).getAttribute('href')).toBe(
      '/u/admin',
    )
    expect(screen.getByRole('menuitem', { name: /Language/ }).getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.getByRole('menuitem', { name: /Theme/ }).getAttribute('aria-haspopup')).toBe('menu')

    fireEvent.click(screen.getByRole('menuitem', { name: /Language/ }))

    expect(screen.getByRole('menuitemradio', { name: 'English' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: '简体中文' }).getAttribute('aria-checked')).toBe('false')

    fireEvent.click(screen.getByRole('menuitem', { name: /Theme/ }))

    expect(screen.getByRole('menuitemradio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('link', { name: 'Account Center' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Account Center' }).getAttribute('href')).toBe('/profile')
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.querySelector('svg')).toBeTruthy()
    }

    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    queryClient.setQueryData(['private'], 'cached')
    await waitFor(() => {
      expect(signOut).toHaveBeenCalledTimes(1)
      expect(queryClient.getQueryData(['private'])).toBeUndefined()
      expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-in' })
    })
  })

  it('marks the dashboard alias active for local visual review', () => {
    pathname = '/console/dashboard'

    render(<TestConsoleShell>Dashboard content</TestConsoleShell>)

    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].getAttribute('aria-current')).toBe('page')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).toContain('is-active')
  })

  it('renders the expected grouped Console navigation rhythm', () => {
    render(<TestConsoleShell>Dashboard content</TestConsoleShell>)

    const consoleNav = screen.getByRole('navigation', { name: 'Console' })
    const groups = ['Identity', 'Develop', 'Authentication', 'Configuration']
    expect(groups.map((group) => within(consoleNav).getByText(group).textContent)).toEqual(groups)
    expect(within(consoleNav).getByRole('link', { name: /Webhooks/ })).toBeTruthy()
    expect(screen.queryByText('Enterprise SSO')).toBeNull()
    expect(screen.queryByRole('link', { name: /Audit logs/ })).toBeNull()
    expect(screen.queryByText('Cloud')).toBeNull()
  })

  it('marks nested Console navigation sections active', () => {
    pathname = '/console/applications/app-1'

    render(<TestConsoleShell>Application details</TestConsoleShell>)

    expect(screen.getAllByRole('link', { name: /Applications/ })[0].className).toContain('is-active')
    expect(screen.getAllByRole('link', { name: /Applications/ })[0].getAttribute('aria-current')).toBe('page')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).not.toContain('is-active')
  })

  it('marks match-based Console navigation items active for nested defaults', () => {
    pathname = '/console/sign-in-experience/theme'

    render(<TestConsoleShell>Branding content</TestConsoleShell>)

    expect(screen.getAllByRole('link', { name: /Experience/ })[0].className).toContain('is-active')
    expect(screen.getAllByRole('link', { name: /Security policies/ })[0].className).not.toContain('is-active')
  })

  it('keeps grouped route-family active states for tenant and developer sections', () => {
    pathname = '/console/webhooks/requests'

    const { rerender } = render(<TestConsoleShell>Webhook requests</TestConsoleShell>)

    expect(screen.getAllByRole('link', { name: /Webhooks/ })[0].className).toContain('is-active')
    expect(screen.queryByRole('link', { name: /Audit logs/ })).toBeNull()

    pathname = '/console/tenant-settings/runtime'
    rerender(<TestConsoleShell>Runtime settings</TestConsoleShell>)

    expect(screen.getAllByRole('link', { name: /Settings/ })[0].className).toContain('is-active')
  })

  it('renders a navigable breadcrumb hierarchy with a non-link current page', () => {
    pathname = '/console/users/user-1/authentication'

    const { rerender } = render(<TestConsoleShell>User authentication</TestConsoleShell>)

    let breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByRole('link', { name: 'Realm' }).getAttribute('href')).toBe('/console')
    expect(within(breadcrumb).queryByText('Identity')).toBeNull()
    expect(within(breadcrumb).getByRole('link', { name: 'Users' }).getAttribute('href')).toBe('/console/users')
    expect(within(breadcrumb).getByText('Authentication').getAttribute('aria-current')).toBe('page')

    pathname = '/console/webhooks/requests'
    rerender(<TestConsoleShell>Webhook requests</TestConsoleShell>)
    breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByRole('link', { name: 'Webhooks' }).getAttribute('href')).toBe('/console/webhooks')
    expect(within(breadcrumb).getByText('Requests').getAttribute('aria-current')).toBe('page')

    pathname = '/console/agents/agent-1/requests'
    rerender(<TestConsoleShell>Agent access requests</TestConsoleShell>)
    breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByText('Access requests').getAttribute('aria-current')).toBe('page')

    pathname = '/console/applications/application-1/oauth'
    rerender(<TestConsoleShell>Application OAuth</TestConsoleShell>)
    breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByText('OAuth').getAttribute('aria-current')).toBe('page')

    pathname = '/console/users/user-1/linked-accounts'
    rerender(<TestConsoleShell>User linked accounts</TestConsoleShell>)
    breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByText('Authentication').getAttribute('aria-current')).toBe('page')

    pathname = '/console/users/user-1/operations'
    rerender(<TestConsoleShell>User operations</TestConsoleShell>)
    breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByText('Settings').getAttribute('aria-current')).toBe('page')
  })

  it('opens responsive Console navigation without exposing onboarding as persistent navigation', () => {
    render(<TestConsoleShell>Users content</TestConsoleShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('navigation', { name: 'Console' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Switch organization' })).toBeNull()
    expect(screen.getAllByRole('link', { name: /Sign-in & registration/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Onboarding/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Audit logs/ })).toBeNull()

    fireEvent.click(screen.getAllByRole('link', { name: /Applications/ })[0])

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('dismisses responsive Console navigation with the Sheet controls and Escape', async () => {
    render(<TestConsoleShell>Users content</TestConsoleShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(within(screen.getByRole('dialog')).getByRole('navigation', { name: 'Console' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open navigation' })))

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
