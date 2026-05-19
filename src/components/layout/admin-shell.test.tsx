import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminShell } from './admin-shell'

let pathname = '/console'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    onClick,
    to,
  }: {
    children: ReactNode
    className?: string
    onClick?: () => void
    to: string
  }) => (
    <a className={className} href={to} onClick={onClick}>
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
    expect(screen.getByText('Dashboard content')).toBeTruthy()
    expect(screen.getByText('Dashboard content').closest('.h-dvh')?.className).toContain('overflow-hidden')
    expect(document.querySelector('header')?.className).toContain('h-16')
    expect(document.querySelector('header')?.className).toContain('w-full')
    expect(document.querySelector('aside')?.className).toContain('w-[248px]')
    expect(document.querySelector('main')?.className).toContain('overflow-y-auto')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).toContain('bg-primary/10')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).toContain('h-9')
    expect(screen.getAllByRole('link', { name: /Applications/ })[0].className).not.toContain('bg-primary/10')
    expect(screen.queryByText('Tenant health')).toBeNull()
    expect(screen.queryByText('OIDC clients')).toBeNull()
    expect(screen.queryByRole('link', { name: /Onboarding/ })).toBeNull()
  })

  it('renders the expected grouped Console navigation rhythm', () => {
    render(<AdminShell>Dashboard content</AdminShell>)

    const consoleNav = screen.getByRole('navigation', { name: 'Console' })
    expect(within(consoleNav).getByText('Overview')).toBeTruthy()
    expect(within(consoleNav).getByText('Authentication')).toBeTruthy()
    expect(within(consoleNav).getByText('Authorization')).toBeTruthy()
    expect(within(consoleNav).getByText('Users')).toBeTruthy()
    expect(within(consoleNav).getByText('Developer')).toBeTruthy()
    expect(within(consoleNav).getByText('Tenant')).toBeTruthy()
    expect(screen.queryByText('Enterprise SSO')).toBeNull()
    expect(screen.queryByText('Cloud')).toBeNull()
  })

  it('marks nested Console navigation sections active', () => {
    pathname = '/console/applications/app-1'

    render(<AdminShell>Application details</AdminShell>)

    expect(screen.getAllByRole('link', { name: /Applications/ })[0].className).toContain('bg-primary/10')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).not.toContain('bg-primary/10')
  })

  it('marks match-based Console navigation items active for nested defaults', () => {
    pathname = '/console/sign-in-experience/branding'

    render(<AdminShell>Branding content</AdminShell>)

    expect(screen.getAllByRole('link', { name: /Sign-in & account/ })[0].className).toContain('bg-primary/10')
    expect(screen.getAllByRole('link', { name: /Security/ })[0].className).not.toContain('bg-primary/10')
  })

  it('opens responsive Console navigation without exposing onboarding as persistent navigation', () => {
    render(<AdminShell>Users content</AdminShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open console navigation' }))

    expect(screen.getByRole('navigation', { name: 'Console mobile' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Sign-in & account/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Onboarding/ })).toBeNull()

    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Console mobile' })).getByRole('link', { name: /Applications/ }),
    )

    expect(screen.queryByRole('navigation', { name: 'Console mobile' })).toBeNull()
  })
})
