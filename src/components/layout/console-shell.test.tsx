import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleShell } from '@/components/layout/console-shell'

let pathname = '/console'
const signOut = vi.fn().mockResolvedValue({})

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    'aria-current': ariaCurrent,
    children,
    className,
    onClick,
    to,
  }: {
    'aria-current'?: 'page'
    children: ReactNode
    className?: string
    onClick?: () => void
    to: string
  }) => (
    <a aria-current={ariaCurrent} className={className} href={to} onClick={onClick}>
      {children}
    </a>
  ),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname } }),
}))

vi.mock('@/lib/auth-client', () => ({
  signOut: () => signOut(),
}))

afterEach(() => {
  cleanup()
  pathname = '/console'
  signOut.mockClear()
  window.history.pushState(null, '', '/')
})

describe('ConsoleShell', () => {
  it('renders Console navigation and marks the exact dashboard route active', () => {
    render(<ConsoleShell>Dashboard content</ConsoleShell>)

    expect(screen.getByText('Admin Console')).toBeTruthy()
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Account menu' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Account center/ })).toBeNull()
    expect(screen.getByText('Dashboard content')).toBeTruthy()
    expect(screen.getByText('Dashboard content').closest('.consoleShell')).toBeTruthy()
    expect(document.querySelector('header')?.className).toContain('consoleTopbar')
    expect(document.querySelector('header')?.className).not.toContain('lg:hidden')
    expect(document.querySelector('aside')?.className).toContain('consoleRail')
    expect(document.querySelector('main')?.className).toContain('consoleMain')
    expect(screen.getByText('Dashboard content').closest('.consoleContent')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].getAttribute('aria-current')).toBe('page')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).toContain('bg-primary/10')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).toContain('h-9')
    expect(screen.getAllByRole('link', { name: /Applications/ })[0].className).not.toContain('bg-primary/10')
    expect(screen.queryByText('Tenant health')).toBeNull()
    expect(screen.queryByText('OIDC clients')).toBeNull()
    expect(screen.queryByRole('link', { name: /Onboarding/ })).toBeNull()
  })

  it('opens the account menu with shell-local actions', async () => {
    render(<ConsoleShell>Dashboard content</ConsoleShell>)

    fireEvent.click(screen.getAllByRole('button', { name: 'Account menu' })[0])

    expect(await screen.findByText('Account')).toBeTruthy()
    expect(screen.queryByText('Admin User')).toBeNull()
    expect(screen.queryByText('admin@example.com')).toBeNull()
    expect(screen.getByRole('menuitem', { name: /Language/ }).getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.getByRole('menuitem', { name: /Theme/ }).getAttribute('aria-haspopup')).toBe('menu')

    fireEvent.click(screen.getByRole('menuitem', { name: /Language/ }))

    expect(screen.getByRole('menuitemradio', { name: 'EN' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: '中文' }).getAttribute('aria-checked')).toBe('false')

    fireEvent.click(screen.getByRole('menuitem', { name: /Theme/ }))

    expect(screen.getByRole('menuitemradio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Profile' }).getAttribute('href')).toBe('/profile')
    const menuItems = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(menuItems).toEqual(['Profile', 'Language', 'Theme', 'Sign out'])
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.querySelector('svg')).toBeTruthy()
    }

    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
  })

  it('marks the dashboard alias active for local visual review', () => {
    pathname = '/console/dashboard'

    render(<ConsoleShell>Dashboard content</ConsoleShell>)

    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].getAttribute('aria-current')).toBe('page')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).toContain('bg-primary/10')
  })

  it('renders the expected grouped Console navigation rhythm', () => {
    render(<ConsoleShell>Dashboard content</ConsoleShell>)

    const consoleNav = screen.getByRole('navigation', { name: 'Console' })
    const groups = ['Overview', 'Authentication', 'Authorization', 'Users', 'Developer', 'Tenant']
    expect(groups.map((group) => within(consoleNav).getByText(group).textContent)).toEqual(groups)
    expect(within(consoleNav).getByRole('link', { name: /Custom JWT/ })).toBeTruthy()
    expect(within(consoleNav).getByRole('link', { name: /Webhooks/ })).toBeTruthy()
    expect(screen.queryByText('Enterprise SSO')).toBeNull()
    expect(screen.queryByRole('link', { name: /Audit logs/ })).toBeNull()
    expect(screen.queryByText('Cloud')).toBeNull()
  })

  it('marks nested Console navigation sections active', () => {
    pathname = '/console/applications/app-1'

    render(<ConsoleShell>Application details</ConsoleShell>)

    expect(screen.getAllByRole('link', { name: /Applications/ })[0].className).toContain('bg-primary/10')
    expect(screen.getAllByRole('link', { name: /Applications/ })[0].getAttribute('aria-current')).toBe('page')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).not.toContain('bg-primary/10')
  })

  it('marks match-based Console navigation items active for nested defaults', () => {
    pathname = '/console/sign-in-experience/branding'

    render(<ConsoleShell>Branding content</ConsoleShell>)

    expect(screen.getAllByRole('link', { name: /Sign-in & account/ })[0].className).toContain('bg-primary/10')
    expect(screen.getAllByRole('link', { name: /Security/ })[0].className).not.toContain('bg-primary/10')
  })

  it('keeps grouped route-family active states for tenant and developer sections', () => {
    pathname = '/console/webhooks/requests'

    const { rerender } = render(<ConsoleShell>Webhook requests</ConsoleShell>)

    expect(screen.getAllByRole('link', { name: /Webhooks/ })[0].className).toContain('bg-primary/10')
    expect(screen.queryByRole('link', { name: /Audit logs/ })).toBeNull()

    pathname = '/console/tenant-settings/runtime'
    rerender(<ConsoleShell>Runtime settings</ConsoleShell>)

    expect(screen.getAllByRole('link', { name: /Settings/ })[0].className).toContain('bg-primary/10')
  })

  it('opens responsive Console navigation without exposing onboarding as persistent navigation', () => {
    render(<ConsoleShell>Users content</ConsoleShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open console navigation' }))

    expect(screen.getByRole('navigation', { name: 'Console mobile' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dismiss console navigation' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Sign-in & account/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Onboarding/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Audit logs/ })).toBeNull()

    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Console mobile' })).getByRole('link', { name: /Applications/ }),
    )

    expect(screen.queryByRole('navigation', { name: 'Console mobile' })).toBeNull()
  })

  it('dismisses responsive Console navigation from the backdrop control', () => {
    render(<ConsoleShell>Users content</ConsoleShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open console navigation' }))
    expect(screen.getByRole('navigation', { name: 'Console mobile' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss console navigation' }))

    expect(screen.queryByRole('navigation', { name: 'Console mobile' })).toBeNull()
  })
})
