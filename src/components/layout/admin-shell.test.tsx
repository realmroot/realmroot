import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminShell } from './admin-shell'

let pathname = '/admin'

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
  pathname = '/admin'
})

describe('AdminShell', () => {
  it('renders admin navigation and marks the exact dashboard route active', () => {
    render(<AdminShell>Dashboard content</AdminShell>)

    expect(screen.getByText('Identity Console')).toBeTruthy()
    expect(screen.getAllByText('Production').length).toBeGreaterThan(0)
    expect(screen.getByText('Dashboard content')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).toContain('bg-primary/10')
    expect(screen.getAllByRole('link', { name: /Applications/ })[0].className).not.toContain('bg-primary/10')
    expect(screen.queryByRole('link', { name: /Onboarding/ })).toBeNull()
  })

  it('marks nested admin navigation sections active', () => {
    pathname = '/admin/applications/app-1'

    render(<AdminShell>Application details</AdminShell>)

    expect(screen.getAllByRole('link', { name: /Applications/ })[0].className).toContain('bg-primary/10')
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0].className).not.toContain('bg-primary/10')
  })

  it('opens responsive admin navigation without exposing onboarding as persistent navigation', () => {
    render(<AdminShell>Users content</AdminShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open admin navigation' }))

    expect(screen.getByRole('navigation', { name: 'Admin mobile' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Sign-in experience/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Onboarding/ })).toBeNull()

    fireEvent.click(screen.getAllByRole('link', { name: /Applications/ }).at(-1)!)

    expect(screen.queryByRole('navigation', { name: 'Admin mobile' })).toBeNull()
  })
})
