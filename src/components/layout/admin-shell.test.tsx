import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminShell } from './admin-shell'

let pathname = '/console'

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

afterEach(() => {
  cleanup()
  pathname = '/console'
})

describe('AdminShell', () => {
  it('renders Console navigation and marks the exact dashboard route active', () => {
    render(<AdminShell>Dashboard content</AdminShell>)

    expect(screen.getAllByText('Console').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Open account center/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Account center/ }).getAttribute('href')).toBe('/profile')
    expect(screen.getByText('Dashboard content')).toBeTruthy()
    expect(screen.getByText('Dashboard content').closest('.consoleShell')).toBeTruthy()
    expect(document.querySelector('header')?.className).toContain('consoleTopbar')
    expect(document.querySelector('header')?.className).toContain('lg:hidden')
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

  it('marks the dashboard alias active for local visual review', () => {
    pathname = '/console/dashboard'

    render(<AdminShell>Dashboard content</AdminShell>)

    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].getAttribute('aria-current')).toBe('page')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).toContain('bg-primary/10')
  })

  it('renders the expected grouped Console navigation rhythm', () => {
    render(<AdminShell>Dashboard content</AdminShell>)

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

    render(<AdminShell>Application details</AdminShell>)

    expect(screen.getAllByRole('link', { name: /Applications/ })[0].className).toContain('bg-primary/10')
    expect(screen.getAllByRole('link', { name: /Applications/ })[0].getAttribute('aria-current')).toBe('page')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).not.toContain('bg-primary/10')
  })

  it('marks match-based Console navigation items active for nested defaults', () => {
    pathname = '/console/sign-in-experience/branding'

    render(<AdminShell>Branding content</AdminShell>)

    expect(screen.getAllByRole('link', { name: /Sign-in & account/ })[0].className).toContain('bg-primary/10')
    expect(screen.getAllByRole('link', { name: /Security/ })[0].className).not.toContain('bg-primary/10')
  })

  it('keeps grouped route-family active states for tenant and developer sections', () => {
    pathname = '/console/webhooks/requests'

    const { rerender } = render(<AdminShell>Webhook requests</AdminShell>)

    expect(screen.getAllByRole('link', { name: /Webhooks/ })[0].className).toContain('bg-primary/10')
    expect(screen.queryByRole('link', { name: /Audit logs/ })).toBeNull()

    pathname = '/console/tenant-settings/runtime'
    rerender(<AdminShell>Runtime settings</AdminShell>)

    expect(screen.getAllByRole('link', { name: /Settings/ })[0].className).toContain('bg-primary/10')
  })

  it('opens responsive Console navigation without exposing onboarding as persistent navigation', () => {
    render(<AdminShell>Users content</AdminShell>)

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
    render(<AdminShell>Users content</AdminShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open console navigation' }))
    expect(screen.getByRole('navigation', { name: 'Console mobile' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss console navigation' }))

    expect(screen.queryByRole('navigation', { name: 'Console mobile' })).toBeNull()
  })
})
